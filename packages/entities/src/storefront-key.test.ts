import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { auditLogs, createMigratorPool, getDb, outboxEvents, storefronts } from "@khidi/db";
import { createUuidV7 } from "@khidi/shared";
import { createStorefront } from "./index.ts";

it("creates an audited storefront with an immutable key and leaves unrelated settings editable", async () => {
  const db = getDb();
  const admin = (await db.query.users.findFirst({ where: (row, { eq }) => eq(row.role, "ADMIN") }))!;
  const operator = (await db.query.users.findFirst({ where: (row, { eq }) => eq(row.role, "OPERATOR") }))!;
  const seller = (await db.query.legalEntities.findFirst())!;
  const input = { key: "store-" + createUuidV7(), name: "Internal fixture store", domain: createUuidV7() + ".example", sellerEntityId: seller.id, mediaBaseUrl: "https://media.example" };
  await expect(createStorefront(db, { userId: operator.id }, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
  const row = await createStorefront(db, { userId: admin.id }, input);
  await expect(db.update(storefronts).set({ key: "renamed-" + createUuidV7() }).where(eq(storefronts.id, row.id))).rejects.toMatchObject({cause:{message:expect.stringMatching(/immutable/)}});
  const pool = createMigratorPool();
  try { await expect(pool.query("UPDATE storefronts SET key=$1 WHERE id=$2", ["new-" + createUuidV7(), row.id])).rejects.toThrow(/immutable/); }
  finally { await pool.end(); }
  await db.update(storefronts).set({ name: "Updated internal name" }).where(eq(storefronts.id, row.id));
  expect(await db.query.storefronts.findFirst({ where: eq(storefronts.id, row.id) })).toMatchObject({ key: input.key, name: "Updated internal name" });
  expect(await db.select().from(auditLogs).where(eq(auditLogs.entityId, row.id))).toHaveLength(1);
  expect(await db.select().from(outboxEvents).where(eq(outboxEvents.aggregateId, row.id))).toMatchObject([{ eventType: "STOREFRONT_CREATED" }]);
});
