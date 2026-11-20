/**
 * Operator-only, additive reset of exploratory photo activity from a catalog pilot.
 * No media, audit logs, product master, reviewer assignments, or photo-work rows are deleted.
 *
 * Run a dry-run first. Requires paired production DATABASE_URL/DATABASE_MIGRATOR_URL,
 * explicit database name, exact event counts per WordPress ID, and the Hub stopped for --apply.
 */
import { parseArgs } from "node:util";
import { spawnSync } from "node:child_process";
import { sql } from "drizzle-orm";
import { connectMigratorDatabase } from "@khidi/db";
import { withDomainTransaction } from "@khidi/domain";
import { assertProductionConfiguration } from "@khidi/shared/production-config";
import { pilotBaseline } from "./access.ts";

const { values } = parseArgs({ options: {
  actor: { type: "string" },
  "expect-database": { type: "string" },
  "expect-counts": { type: "string" },
  apply: { type: "boolean" }
}, strict: true });
const actorEmail = values.actor?.trim();
const counts = values["expect-counts"]?.split(",").map(s => {
  const found = /^(\d+):(\d+)$/.exec(s.trim());
  if (!found) throw new Error("Expect comma-separated WordPress ID:count values.");
  return { wp: Number(found[1]), count: Number(found[2]) };
}) ?? [];
if (!actorEmail || !values["expect-database"] || !counts.length || counts.some(v =>
  !Number.isSafeInteger(v.wp) || v.wp < 1 || !Number.isSafeInteger(v.count) || v.count < 1
) || new Set(counts.map(v => v.wp)).size !== counts.length) {
  throw new Error("Required: --actor=EMAIL --expect-database=NAME --expect-counts=7171:44,7393:2 [--apply]");
}
assertProductionConfiguration(process.env, "deployment");
if (values.apply) {
  const status = spawnSync("systemctl", ["is-active", "khidi-hub"], { encoding: "utf8" });
  if (status.status === 0 || status.error) {
    throw new Error("Stop khidi-hub before applying a photo-test reset.");
  }
}
const actualDatabase = decodeURIComponent(new URL(process.env.DATABASE_MIGRATOR_URL!).pathname.slice(1));
if (actualDatabase !== values["expect-database"] || actualDatabase.endsWith("_test") || actualDatabase.endsWith("_dev")) {
  throw new Error("Expected database mismatch or test database.");
}

const connection = connectMigratorDatabase();
try {
  const db = connection.db;
  const actors = await db.execute<{ id: string }>(sql`
    SELECT id FROM users WHERE email = ${actorEmail} AND role = 'ADMIN' AND active = true
  `);
  if (actors.rows.length !== 1) throw new Error("One active ADMIN with that email is required.");
  const actorId = actors.rows[0]!.id;
  await withDomainTransaction(db, { userId: actorId }, async ctx => {
    await ctx.tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('catalog-review-photo-test-reset', 0))`);
    const selected = await ctx.tx.execute<{ id: string }>(sql`
      SELECT b.id FROM catalog_review_batches b
      WHERE b.sources->>'baseline' = ${pilotBaseline}
        AND EXISTS (SELECT 1 FROM catalog_legacy_products p WHERE p.batch_id=b.id AND p.recommended_order IS NOT NULL)
      ORDER BY b.created_at, b.id LIMIT 1
    `);
    if (selected.rows.length !== 1) throw new Error("Pilot batch not found.");
    const batchId = selected.rows[0]!.id;
    const products = await ctx.tx.execute<{ id: string; wp: number; events: number; accepted: number; previews: number; last_at: Date }>(sql`
      SELECT p.id, p.wordpress_id AS wp,
        COUNT(w.id)::int AS events,
        COUNT(w.id) FILTER (WHERE w.kind = 'ACCEPT')::int AS accepted,
        COUNT(w.id) FILTER (WHERE w.kind = 'PREVIEW')::int AS previews,
        MAX(w.created_at) + interval '1 millisecond' AS last_at
      FROM catalog_legacy_products p
      LEFT JOIN catalog_review_photo_work w ON w.product_id=p.id AND w.actor_id=${actorId}
      WHERE p.batch_id=${batchId}
        AND p.wordpress_id IN (${sql.join(counts.map(c => sql`${c.wp}`), sql`, `)})
      GROUP BY p.id, p.wordpress_id
    `);
    if (products.rows.length !== counts.length || products.rows.some(row =>
      counts.find(c => c.wp === row.wp)?.count !== row.events || !row.last_at
    )) throw new Error("Photo event counts changed. Abort without writing.");
    const feedback = await ctx.tx.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM catalog_feedback_entries e
      JOIN catalog_legacy_products p ON p.id=e.product_id
      WHERE p.batch_id=${batchId} AND e.actor_id=${actorId}
        AND p.wordpress_id IN (${sql.join(counts.map(c => sql`${c.wp}`), sql`, `)})
    `);
    if (feedback.rows[0]?.n !== 0) throw new Error("Saved feedback exists. This command cannot reset it.");
    const existing = await ctx.tx.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM catalog_review_photo_test_resets r
      WHERE r.actor_id=${actorId} AND r.product_id IN
        (${sql.join(products.rows.map(row => sql`${row.id}::uuid`), sql`, `)})
    `);
    if (existing.rows[0]?.n !== 0) throw new Error("This actor/product has already been reset.");
    console.table(products.rows.map(r => ({ wordpress_id: r.wp, test_events: r.events, previews: r.previews, accepted: r.accepted })));
    if (!values.apply) {
      console.log("DRY RUN ONLY. No reset markers written.");
      return;
    }
    for (const p of products.rows) {
      const reason = "Void owner exploratory photo test run before Lika's round-one review";
      await ctx.tx.execute(sql`
        INSERT INTO catalog_review_photo_test_resets (batch_id, product_id, actor_id, cutoff_at, reason)
        VALUES (${batchId}::uuid,${p.id}::uuid,${actorId}::uuid,${p.last_at},${reason})
      `);
      await ctx.recordAudit({ action: "CATALOG_REVIEW_TEST_RESET", entityType: "catalog_legacy_product", entityId: p.id,
        after: { actorId, through: p.last_at.toISOString(), events: p.events, accepted: p.accepted } });
    }
    console.log("TEST RESET MARKERS COMMITTED:", products.rows.length);
  });
} finally {
  await connection.close();
}
