import { afterAll, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { AuthenticatedPrincipal } from "@khidi/auth";
import {
  catalogFeedbackCards as cards, catalogFeedbackClosures as closures, catalogFeedbackEntries as entries,
  catalogLegacyProducts as products, catalogReviewAssignments as assignments, catalogReviewBatches as batches,
  catalogReviewPhotoLinks as links, catalogReviewPhotos as photos, catalogReviewPhotoWork as work,
  catalogReviewProposals as proposals, closeAppPool, connectMigratorDatabase, getAppPool, users,
  type AppDatabase, type DbExecutor
} from "@khidi/db";
import { FilesystemMediaStorage } from "@khidi/media/storage";
import { createUuidV7 as uuid } from "@khidi/shared";
import { pilotBaseline } from "./access.ts";
import { cardDefinition, startReview } from "./fields.ts";
import { acceptReviewDraft, renderReviewDraft, requestReviewEdit, uploadReviewImage } from "./photo-work.ts";
import { listPilot, savePilot } from "./pilot.ts";
import { saveRound } from "./rounds.ts";

afterAll(closeAppPool);

const pendingError = { code: "CONFLICT", details: { reason: "PHOTO_RENDER_PENDING" } };
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAE0lEQVQImWP4z8DwnwGM/zMwAAAf7gP9qS/A4gAAAABJRU5ErkJggg==", "base64");
const providerResponse = () => Response.json({ data: [{ b64_json: png.toString("base64") }] });
const connectApp = () => getAppPool().connect();
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

async function fixture(db: DbExecutor, createdAt: Date) {
  const template = (await db.select().from(cards).where(eq(cards.round, 1)).orderBy(asc(cards.position)))
    .map(row => cardDefinition.parse(row.definition));
  const person: AuthenticatedPrincipal = { userId: uuid(), role: "CATALOG_REVIEWER", email: null, fullName: "Render reviewer",
    locale: "ka", entityIds: [], permissions: [], authMethod: "OFFICE_PASSWORD_TOTP", deviceId: null };
  const admin = { ...person, userId: uuid(), role: "ADMIN" as const };
  const batchId = uuid();
  const items = [...template.map(card => card.wp), ...Array.from({ length: 21 }, (_, i) => 987654 + i)]
    .map(wp => ({ id: uuid(), wp }));
  await db.insert(users).values([person, admin].map(p => ({ id: p.userId, role: p.role, fullName: p.fullName,
    email: p.userId + "@example.test" })));
  await db.insert(batches).values({ id: batchId, createdAt, sources: { baseline: pilotBaseline },
    sourceSha256: batchId.replaceAll("-", "").repeat(2) });
  await db.insert(assignments).values({ batchId, userId: person.userId });
  await db.insert(products).values(items.map((item, i) => ({ id: item.id, batchId, wordpressId: item.wp,
    sourceStatus: "PUBLISHED" as const, baseline: {}, reviewSource: {}, recommendedOrder: i < 20 ? i + 1 : null })));
  await db.insert(proposals).values(items.map(item => ({ id: uuid(), productId: item.id, field: "NAME" as const,
    proposed: "fixture", observation: "source", rationale: "source" })));
  return { person, admin, batchId, items,
    close: { action: "CLOSE" as const, round: 1, note: "Enough learned from the drafts" },
    open: { action: "OPEN" as const, round: 1, choice: "KEEP" as const, note: "Keep the tested fields",
      cards: items.slice(20, 40).map(item => ({ ...template[0]!, wp: item.wp, links: [] })) } };
}

/** Observe the actual database lock wait, rather than assuming that an elapsed delay means a write was blocked. */
async function waitForBlock(db: DbExecutor, waiter: number, blocker: number) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const result = await db.execute<{ blocked: boolean }>(sql`SELECT ${blocker}::int = ANY(pg_blocking_pids(${waiter}::int)) AS blocked`);
    if (result.rows[0]?.blocked) return;
  }
  throw new Error("Render did not wait for the round transaction");
}

it("retains an in-flight paid result, blocks closure, and orders new renders behind the exclusive round lock", async () => {
  const migrator = connectMigratorDatabase();
  const directory = await mkdtemp(join(tmpdir(), "round-photo-work-"));
  const providerStarted = deferred<void>(), providerResult = deferred<Response>(), releaseClose = deferred<void>();
  let renderClient: Awaited<ReturnType<typeof connectApp>> | undefined;
  let closeClient: typeof renderClient;
  let rendering: ReturnType<typeof renderReviewDraft> | undefined;
  let nextRender: ReturnType<typeof renderReviewDraft> | undefined;
  let closing: Promise<unknown> | undefined;
  try {
    // Committed media fixtures are needed by independent sessions. Global round changes below always roll back.
    // Existing pilot tests use an older (2000) batch and therefore still select their own isolated fixture.
    const [previous] = await migrator.db.select({
      earliest: sql<number | null>`(extract(epoch from min(${batches.createdAt})) * 1000)::double precision`
    }).from(batches).where(sql`${batches.sources}->>'baseline' = ${pilotBaseline}`);
    const createdAt = new Date(Math.min(Date.parse("2020-01-01T00:00:00Z"), previous?.earliest ?? Infinity) - 1);
    const f = await migrator.db.transaction(tx => fixture(tx, createdAt));
    renderClient = await connectApp();
    closeClient = await connectApp();
    const renderDb = drizzle(renderClient) as unknown as AppDatabase;
    const closeDb = drizzle(closeClient) as unknown as AppDatabase;
    const renderPid = (await renderDb.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)).rows[0]!.pid;
    const closePid = (await closeDb.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)).rows[0]!.pid;
    expect(renderPid).not.toBe(closePid);
    const storage = new FilesystemMediaStorage(directory), productId = f.items[0]!.id;
    const uploaded = await uploadReviewImage(renderDb, storage, f.person, uuid(), { kind: "UPLOAD", productId }, png);
    const request = await requestReviewEdit(renderDb, storage, f.person, uuid(), {
      productId, basePhotoId: uploaded.body.photoId, mode: "BACKGROUND"
    });
    const row = (await listPilot(renderDb, f.person, 1))[0]!;
    await savePilot(renderDb, f.person, uuid(), { productId, revision: 0, submit: false,
      response: { fields: startReview(row.original), answers: row.card.questions.map(() => ({ state: "", text: "", source: "" })) } });
    const saved = await renderDb.select().from(entries).where(eq(entries.productId, productId));
    vi.stubEnv("REVIEW_OPENAI_API_KEY", "test-only");
    const provider = vi.fn().mockImplementationOnce(() => { providerStarted.resolve(); return providerResult.promise; })
      .mockImplementation(async () => providerResponse());
    vi.stubGlobal("fetch", provider);
    rendering = renderReviewDraft(renderDb, storage, f.person, uuid(), {
      productId, requestId: request.body.id, model: "gpt-image-2.6-sunburst"
    });
    await Promise.race([providerStarted.promise, rendering.then(() => { throw new Error("Provider did not pause"); })]);
    const attempt = (await closeDb.select().from(work).where(eq(work.parentId, request.body.id)))[0]!;
    expect(attempt.kind).toBe("RENDER"); // The other connection sees the committed attempt while the provider is paused.
    expect(await closeDb.select().from(work).where(eq(work.parentId, attempt.id))).toEqual([]);
    const closeKey = uuid();
    await expect(saveRound(closeDb, f.admin, closeKey, f.close)).rejects.toMatchObject(pendingError);
    expect(await closeDb.select().from(closures).where(eq(closures.round, 1))).toEqual([]);
    expect(await closeDb.select().from(entries).where(eq(entries.productId, productId))).toEqual(saved);

    providerResult.resolve(providerResponse());
    const preview = await rendering;
    const [result] = await closeDb.select().from(work).where(eq(work.id, preview.body.id));
    expect(result).toMatchObject({ kind: "PREVIEW", parentId: attempt.id });
    const [asset] = await closeDb.select().from(photos).where(eq(photos.id, result!.photoId!));
    expect((await storage.readPrivate(asset!.rawKey, asset!.rawSha256)).length).toBeGreaterThan(0);
    await acceptReviewDraft(renderDb, f.person, uuid(), { productId, previewId: preview.body.id });
    expect(await closeDb.select().from(links).where(eq(links.photoId, result!.photoId!))).toHaveLength(1);

    const another = await requestReviewEdit(renderDb, storage, f.person, uuid(), {
      productId, basePhotoId: uploaded.body.photoId, mode: "BACKGROUND"
    });
    const closeHeld = deferred<void>(), rollback = new Error("rollback global round closure");
    closing = closeDb.transaction(async tx => {
      // The same idempotency key is usable after the rejected, rolled-back close.
      await saveRound(tx as unknown as AppDatabase, f.admin, closeKey, f.close);
      expect((await tx.select().from(closures).where(eq(closures.round, 1)))[0])
        .toMatchObject({ drafts: 1, submitted: 0, untouched: 19 });
      closeHeld.resolve();
      await releaseClose.promise;
      throw rollback;
    });
    void closing.catch(() => undefined);
    await Promise.race([closeHeld.promise, closing.then(() => { throw new Error("Closure did not stay open"); })]);
    nextRender = renderReviewDraft(renderDb, storage, f.person, uuid(), {
      productId, requestId: another.body.id, model: "gpt-image-2.6-sunburst"
    });
    await Promise.race([waitForBlock(migrator.db, renderPid, closePid),
      nextRender.then(() => { throw new Error("Render passed the exclusive round lock"); })]);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(await migrator.db.select().from(work).where(eq(work.parentId, another.body.id))).toEqual([]);
    releaseClose.resolve();
    await expect(closing).rejects.toBe(rollback);
    await nextRender;
    expect(provider).toHaveBeenCalledTimes(2);
    expect(await closeDb.select().from(entries).where(eq(entries.productId, productId))).toEqual(saved);
    expect(await closeDb.select().from(closures).where(eq(closures.round, 1))).toEqual([]);
  } finally {
    providerResult.resolve(providerResponse());
    releaseClose.resolve();
    await Promise.allSettled([rendering, closing, nextRender].filter((value): value is Promise<unknown> => Boolean(value)));
    renderClient?.release();
    closeClient?.release();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await migrator.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);

async function seedPhoto(db: DbExecutor, batchId: string, productId: string) {
  const id = uuid();
  await db.insert(photos).values({ id, batchId, assetKey: id, sourceUrl: "https://example.test/source.jpg", audit: {},
    rawKey: "raw/" + id, rawSha256: "a".repeat(64), previewKey: "master/" + id, previewSha256: "a".repeat(64) });
  await db.insert(links).values({ batchId, productId, photoId: id, position: 1 });
  return id;
}

async function seedAttempt(db: DbExecutor, batchId: string, productId: string, actorId: string, photoId: string,
  options: { terminal?: "PREVIEW" | "FAILED"; createdAt?: Date } = {}) {
  const requestId = uuid(), id = uuid();
  await db.insert(work).values({ id: requestId, batchId, productId, actorId, kind: "REQUEST", basePhotoId: photoId,
    mode: "BACKGROUND", createdAt: options.createdAt });
  await db.insert(work).values({ id, batchId, productId, actorId, kind: "RENDER", parentId: requestId,
    model: "gpt-image-2.6-sunburst", createdAt: options.createdAt });
  if (options.terminal) await db.insert(work).values({ id: uuid(), batchId, productId, actorId, kind: options.terminal,
    parentId: id, ...(options.terminal === "PREVIEW" ? { photoId } : {}) });
  return id;
}

it("checks only visible attempts in the affected round, accepts either terminal result, and also protects OPEN", async () => {
  const migrator = connectMigratorDatabase(), rollback = new Error("rollback round photo scopes");
  try {
    await expect(migrator.db.transaction(async tx => {
      const f = await fixture(tx, new Date("2000-01-01T00:00:00Z"));
      const productId = f.items[0]!.id, photoId = await seedPhoto(tx, f.batchId, productId);
      await seedAttempt(tx, f.batchId, productId, f.person.userId, photoId, { terminal: "PREVIEW" });
      await seedAttempt(tx, f.batchId, productId, f.person.userId, photoId, { terminal: "FAILED" });
      // A reset hides only the old experiment, not a visible unresolved attempt by the same actor.
      await seedAttempt(tx, f.batchId, productId, f.person.userId, photoId, { createdAt: new Date("2010-01-01T00:00:00Z") });
      await tx.execute(sql`INSERT INTO catalog_review_photo_test_resets (batch_id, product_id, actor_id, cutoff_at, reason)
        VALUES (${f.batchId}, ${productId}, ${f.person.userId}, '2011-01-01T00:00:00Z', 'Voided fixture experiment')`);
      // An unselected product and a re-import of the same WordPress ID are outside this round's batch/product scope.
      const outside = f.items[40]!.id, outsidePhoto = await seedPhoto(tx, f.batchId, outside);
      await seedAttempt(tx, f.batchId, outside, f.person.userId, outsidePhoto);
      const otherBatch = uuid(), otherProduct = uuid();
      await tx.insert(batches).values({ id: otherBatch, sources: { baseline: pilotBaseline }, sourceSha256: otherBatch.replaceAll("-", "").repeat(2) });
      await tx.insert(products).values({ id: otherProduct, batchId: otherBatch, wordpressId: f.items[0]!.wp,
        sourceStatus: "PUBLISHED", baseline: {}, reviewSource: {} });
      const otherPhoto = await seedPhoto(tx, otherBatch, otherProduct);
      await seedAttempt(tx, otherBatch, otherProduct, f.person.userId, otherPhoto);
      const pending = await seedAttempt(tx, f.batchId, productId, f.person.userId, photoId,
        { createdAt: new Date("2012-01-01T00:00:00Z") }); // Age alone must never discard an uncertain provider result.
      await tx.execute(sql`SET LOCAL ROLE hub_app`);
      const db = tx as unknown as AppDatabase;
      await expect(saveRound(db, f.admin, uuid(), f.close)).rejects.toMatchObject(pendingError);
      await tx.insert(work).values({ id: uuid(), batchId: f.batchId, productId, actorId: f.person.userId,
        kind: "FAILED", parentId: pending });
      const closeRollback = new Error("rollback eligible close");
      await expect(tx.transaction(async nested => {
        await saveRound(nested as unknown as AppDatabase, f.admin, uuid(), f.close);
        expect((await nested.select().from(closures).where(eq(closures.round, 1)))[0])
          .toMatchObject({ submitted: 0, drafts: 0, untouched: 20 });
        throw closeRollback;
      })).rejects.toBe(closeRollback);

      const pendingAtSubmit = await seedAttempt(tx, f.batchId, productId, f.person.userId, photoId);
      const rows = await listPilot(db, f.person, 1);
      await tx.insert(entries).values(rows.map(row => ({ id: uuid(), productId: row.id, actorId: f.person.userId,
        revision: 1, submitted: true, response: {}, card: row.card })));
      await expect(saveRound(db, f.admin, uuid(), f.open)).rejects.toMatchObject(pendingError);
      // Optional closing answers do not freeze a round and remain available while a render settles.
      await saveRound(db, f.person, uuid(), { action: "SURVEY", round: 1, answers: ["First", "Second", "Third"] });
      await tx.insert(work).values({ id: uuid(), batchId: f.batchId, productId, actorId: f.person.userId,
        kind: "PREVIEW", parentId: pendingAtSubmit, photoId });
      await saveRound(db, f.admin, uuid(), f.open);
      expect((await listPilot(db, f.person))[0]?.round).toBe(2);
      throw rollback;
    })).rejects.toBe(rollback);
  } finally { await migrator.close(); }
}, 30000);
