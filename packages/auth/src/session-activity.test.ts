import { beforeAll, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { getDb, sessions, users, SEED_CONSTANTS } from "@khidi/db";
import { createUuidV7, sha256Hex } from "@khidi/shared";
import { assertTestDatabaseSafety } from "../../db/src/test-database-safety.ts";
import { loginWithWarehousePin, renewSessionActivity, verifySessionToken } from "./index.ts";
import { assertRecentStrongAuth } from "./security-session.ts";
import { sessionTiming, sessionIdleLimitMs } from "./session-timing.ts";

const db = getDb();
beforeAll(async () => {
  assertTestDatabaseSafety();
  const target = await db.execute(sql`SELECT current_database() AS name`);
  if (!String(target.rows[0]?.name).endsWith("_test")) throw Error("SAFETY: Session fixtures require a test database.");
});

async function office() {
  const userId = createUuidV7(), id = createUuidV7(), token = `khidi_sess_${createUuidV7()}`;
  await db.insert(users).values({ id: userId, email: `${userId}@khidi.example`, fullName: "Idle fixture", role: "OPERATOR", passwordHash: "synthetic-unused-hash" });
  await db.insert(sessions).values({ id, userId, tokenHash: sha256Hex(token), authMethod: "OFFICE_PASSWORD_TOTP",
    lastStrongAuthAt: new Date(Date.now() - 11 * 60_000), lastActivityAt: new Date(Date.now() - 120_000), expiresAt: new Date(Date.now() + 12 * 60 * 60_000) });
  return { id, token, timing: (await verifySessionToken(db, token)).sessionTiming! };
}

it.each(["OFFICE_PASSWORD_TOTP", "OFFICE_PASSKEY", "WAREHOUSE_PIN"])("enforces the exact method-specific idle boundary for %s", (authMethod) => {
  const base = 1_000_000, limit = (authMethod === "WAREHOUSE_PIN" ? 10 : 20) * 60_000;
  const row = { id: "fixture", authMethod, lastActivityAt: new Date(base), expiresAt: new Date(base + 12 * 60 * 60_000) };
  expect(sessionTiming(row, base + limit - 1).deadlineMs).toBe(base + limit);
  expect(() => sessionTiming(row, base + limit)).toThrow(/expired/);
});

it("does not renew when background API or page checks authenticate a session", async () => {
  const f = await office();
  for (let i = 0; i < 3; i++) expect((await verifySessionToken(db, f.token)).sessionTiming?.lastActivityAtMs).toBe(f.timing.lastActivityAtMs);
  await db.update(sessions).set({ lastActivityAt: sql`clock_timestamp() - interval '20 minutes'` }).where(eq(sessions.id, f.id));
  await expect(verifySessionToken(db, f.token)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  await expect(renewSessionActivity(db, f.token, f.id, f.timing.lastActivityAtMs)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
});

it("coalesces parallel activity, rejects stale revisions, and never upgrades strong proof", async () => {
  const f = await office();
  const original = (await verifySessionToken(db, f.token)).lastStrongAuthAt;
  const results = await Promise.all(Array.from({ length: 4 }, () => renewSessionActivity(db, f.token, f.id, f.timing.lastActivityAtMs)));
  expect(new Set(results.map((result) => result.lastActivityAtMs)).size).toBe(1);
  expect(results[0]!.lastActivityAtMs).toBeGreaterThan(f.timing.lastActivityAtMs);
  expect(results[0]!.absoluteDeadlineMs).toBe(f.timing.absoluteDeadlineMs);
  const latest = await verifySessionToken(db, f.token);
  expect(latest.lastStrongAuthAt).toEqual(original);
  await expect(db.transaction((tx) => assertRecentStrongAuth(tx, latest))).rejects.toMatchObject({ code: "RECENT_AUTH_REQUIRED" });
  const [older] = await db.update(sessions).set({ lastActivityAt: sql`clock_timestamp() - interval '45 seconds'` }).where(eq(sessions.id, f.id)).returning();
  expect((await renewSessionActivity(db, f.token, f.id, f.timing.lastActivityAtMs)).lastActivityAtMs).toBe(older!.lastActivityAt.getTime());
});

it("cannot use a stale tab to renew a different session, and clamps renewal to absolute expiry", async () => {
  const f = await office(), other = await office();
  await expect(renewSessionActivity(db, other.token, f.id, f.timing.lastActivityAtMs)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  const expiresAt = new Date(Date.now() + 60_000);
  await db.update(sessions).set({ expiresAt }).where(eq(sessions.id, f.id));
  const renewed = await renewSessionActivity(db, f.token, f.id, f.timing.lastActivityAtMs);
  expect(renewed.deadlineMs).toBe(expiresAt.getTime());
  await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1) }).where(eq(sessions.id, f.id));
  await expect(renewSessionActivity(db, f.token, f.id, renewed.lastActivityAtMs)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
});

it("rejects an otherwise current heartbeat that waits on a row lock past the idle deadline", async () => {
  const f = await office();
  const outcome = await db.transaction(async (tx) => {
    const [row] = await tx.update(sessions).set({ lastActivityAt: sql`clock_timestamp() - (${sessionIdleLimitMs("OFFICE_PASSWORD_TOTP") - 450} * interval '1 millisecond')` }).where(eq(sessions.id, f.id)).returning();
    const renewal = renewSessionActivity(db, f.token, f.id, row!.lastActivityAt.getTime()).then(() => null, (error: unknown) => error);
    await new Promise((resolve) => setTimeout(resolve, 550));
    return { renewal, previous: row!.lastActivityAt };
  });
  expect(await outcome.renewal).toMatchObject({ code: "UNAUTHORIZED" });
  expect((await db.select().from(sessions).where(eq(sessions.id, f.id)))[0]?.lastActivityAt).toEqual(outcome.previous);
});

it("allows a fresh warehouse PIN sign-in after the old session expires", async () => {
  const [staff] = await db.select().from(users).where(eq(users.email, "warehouse.giorgi@agrotrade.local"));
  const input = { rawDeviceToken: SEED_CONSTANTS.WAREHOUSE_DEVICE_TOKEN, userId: staff!.id, pin: SEED_CONSTANTS.WAREHOUSE_PIN };
  const first = await loginWithWarehousePin(db, input);
  const old = first.principal.sessionTiming!;
  expect(old.deadlineMs - old.lastActivityAtMs).toBe(10 * 60_000);
  await db.update(sessions).set({ lastActivityAt: sql`clock_timestamp() - interval '10 minutes'` }).where(eq(sessions.id, old.sessionId));
  await expect(verifySessionToken(db, first.sessionToken)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  const second = await loginWithWarehousePin(db, input);
  expect(second.principal.sessionId).not.toBe(old.sessionId);
  expect(second.principal.authMethod).toBe("WAREHOUSE_PIN");
});
