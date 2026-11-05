import { expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { getDb, users, sessions, registeredDevices, auditLogs, outboxEvents, type DbExecutor } from "@khidi/db";
import { assertTestDatabaseSafety } from "../../db/src/test-database-safety.ts";
import { AppError, createUuidV7, sha256Hex } from "@khidi/shared";
import { generateCurrentTotpToken, generateTotpSecret, hashSecret, loginOfficeUser, loginWithWarehousePin, verifySecret, verifySessionToken } from "./index.ts";
import { canResetTotpForRecovery, inspectRecoveryUser, recoverUser, type RecoveryInput } from "./recovery.ts";

const oldPassword = "Synthetic-old-password-123", newPassword = "Synthetic-new-password-456";
const email = "recovery@khidi.example";
const recovery: RecoveryInput = { email, confirmationEmail: email, resetTotp: true, newPassword,
  revokeSessions: true, note: "Lost authenticator; server operator verified the account owner." };

// Dedicated test DB only, plus temporary shadow tables: never reset a real/seeded account.
async function withUserFixture(run: (tx: DbExecutor, id: string) => Promise<void>, overrides: Partial<typeof users.$inferInsert> = {}) {
  assertTestDatabaseSafety();
  const db = getDb();
  const result = await db.execute(sql`SELECT current_database() AS name`);
  if (!String(result.rows[0]?.name).endsWith("_test")) throw new Error("SAFETY: Recovery fixtures require an actual _test database.");
  await db.transaction(async (tx) => {
    for (const name of ["users", "sessions", "registered_devices", "audit_logs", "outbox_events"]) {
      await tx.execute(sql.raw(`CREATE TEMP TABLE ${name} (LIKE public.${name} INCLUDING ALL) ON COMMIT DROP`));
    }
    const id = createUuidV7();
    await tx.insert(users).values({ id, email, fullName: "Recovery fixture", role: "ADMIN",
      passwordHash: await hashSecret(oldPassword), ...overrides });
    await tx.insert(sessions).values({ id: createUuidV7(), userId: id, tokenHash: sha256Hex("old-session"),
      authMethod: "OFFICE_PASSWORD_TOTP", expiresAt: new Date(Date.now() + 60000) });
    await run(tx, id);
  });
}

async function enrollment(tx: DbExecutor, password = newPassword, restartEnrollment = false) {
  try { await loginOfficeUser(tx, { email, password, restartEnrollment }); }
  catch (error) {
    if (error instanceof AppError && error.details?.totpEnrollment) return error.details.totpEnrollment as { base32Secret: string; otpauthUri: string };
    throw error;
  }
  throw new Error("Expected enrollment without a session.");
}

it("recovers atomically, revokes sessions and audits only actions/counts and the operator note", async () => {
  await withUserFixture(async (tx, id) => {
    const result = await recoverUser(tx, recovery);
    expect(result).toMatchObject({ userId: id, sessionsRevoked: 1 });
    const [user] = await tx.select().from(users);
    expect(user).toMatchObject({ totpEnabled: false, totpEnrollmentRequired: true, totpSecretEncrypted: null });
    expect(await verifySecret(newPassword, user!.passwordHash!)).toBe(true);
    expect(await verifySecret(oldPassword, user!.passwordHash!)).toBe(false);
    await expect(verifySessionToken(tx, "old-session")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const audits = await tx.select().from(auditLogs), events = await tx.select().from(outboxEvents);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: "USER_RECOVERY_PERFORMED", actorUserId: null, reason: recovery.note });
    expect(events[0]?.eventType).toBe("USER_RECOVERY_PERFORMED");
    const recorded = JSON.stringify({ audits, events });
    expect(recorded).not.toContain(oldPassword); expect(recorded).not.toContain(newPassword);
    expect(recorded).not.toContain(user!.passwordHash);
  });
});

it("rolls back password/TOTP/session changes when the audit fails after those changes", async () => {
  await withUserFixture(async (tx) => {
    const before = await tx.select().from(users);
    await tx.execute(sql`ALTER TABLE pg_temp.audit_logs ADD CHECK (action <> 'USER_RECOVERY_PERFORMED')`);
    await expect(recoverUser(tx, recovery)).rejects.toThrow();
    expect(await tx.select().from(users)).toEqual(before);
    expect(await tx.select().from(sessions)).toHaveLength(1);
    expect(await tx.select().from(auditLogs)).toHaveLength(0);
    expect(await tx.select().from(outboxEvents)).toHaveLength(0);
  });
});

it("refuses a mismatched confirmation or empty operator note without changes", async () => {
  await withUserFixture(async (tx) => {
    const before = await tx.select().from(users);
    await expect(recoverUser(tx, { ...recovery, confirmationEmail: "someone-else@khidi.example" })).rejects.toThrow(/confirmation/);
    await expect(recoverUser(tx, { ...recovery, note: "  " })).rejects.toThrow(/note/);
    expect(await tx.select().from(users)).toEqual(before);
    expect(await tx.select().from(auditLogs)).toHaveLength(0);
  });
});

it.each(["absent", "inactive"])("refuses %s users", async (kind) => {
  await withUserFixture(async (tx, id) => {
    if (kind === "inactive") await tx.update(users).set({ active: false }).where(eq(users.id, id));
    const target = kind === "absent" ? "absent@khidi.example" : email;
    await expect(recoverUser(tx, { ...recovery, email: target, confirmationEmail: target })).rejects.toThrow(/inactive/);
    await expect(inspectRecoveryUser(tx, target)).rejects.toThrow(/inactive/);
    expect(await tx.select().from(auditLogs)).toHaveLength(0);
  });
});

it.each(["ADMIN", "STOCK_MANAGER", "OPERATOR"])("forces confirmed enrollment for a recovered %s and preserves it on refresh", async (role) => {
  await withUserFixture(async (tx) => {
    await recoverUser(tx, recovery);
    await expect(loginOfficeUser(tx, { email, password: oldPassword })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const first = await enrollment(tx);
    expect((await enrollment(tx)).base32Secret).toBe(first.base32Secret);
    expect(await tx.select().from(sessions)).toHaveLength(0);
    await expect(loginOfficeUser(tx, { email, password: newPassword, totpCode: "invalid" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const [failed] = await tx.select().from(users);
    expect(failed!.failedLoginAttempts).toBe(2); // Old password failure + invalid confirmation; recovery never clears lockout history.
    const restarted = await enrollment(tx, newPassword, true);
    expect(restarted.base32Secret).not.toBe(first.base32Secret);
    const audits = await tx.select().from(auditLogs);
    expect(audits.filter((a) => a.action === "TOTP_ENROLLMENT_STARTED")).toHaveLength(1);
    expect(audits.filter((a) => a.action === "TOTP_ENROLLMENT_RESTARTED")).toHaveLength(1);
    const signedIn = await loginOfficeUser(tx, { email, password: newPassword, totpCode: generateCurrentTotpToken(restarted.base32Secret) });
    expect((await verifySessionToken(tx, signedIn.sessionToken)).userId).toBe(signedIn.principal.userId);
    const [user] = await tx.select().from(users);
    expect(user).toMatchObject({ totpEnabled: true, totpEverEnabled: true, totpEnrollmentRequired: false });
    await expect(loginOfficeUser(tx, { email, password: newPassword, restartEnrollment: true })).rejects.toThrow(/unfinished/);
    await expect(loginOfficeUser(tx, { email, password: newPassword })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(JSON.stringify(await tx.select().from(auditLogs))).not.toContain(restarted.base32Secret);
  }, { role, totpEnabled: true, totpSecretEncrypted: generateTotpSecret(email).encryptedSecret });
});

it("retains the security floor of a formerly TOTP-enabled OPERATOR through repeated recovery", async () => {
  await withUserFixture(async (tx) => {
    expect((await inspectRecoveryUser(tx, email)).canResetTotp).toBe(true);
    await recoverUser(tx, recovery);
    const [user] = await tx.select().from(users);
    expect(user).toMatchObject({ totpEverEnabled: true, totpSecretEncrypted: null, totpEnabled: false });
    expect((await inspectRecoveryUser(tx, email)).canResetTotp).toBe(true);
    await recoverUser(tx, { ...recovery, newPassword: undefined });
    expect((await tx.select().from(users))[0]!.totpEnrollmentRequired).toBe(true);
  }, { role: "OPERATOR", totpEverEnabled: true });
});

it.each(["OPERATOR", "WAREHOUSE"])("does not offer/reset TOTP for a %s who never configured it", async (role) => {
  await withUserFixture(async (tx) => {
    expect((await inspectRecoveryUser(tx, email)).canResetTotp).toBe(false);
    expect(canResetTotpForRecovery((await tx.select().from(users))[0]!)).toBe(false);
    await expect(recoverUser(tx, recovery)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await recoverUser(tx, { ...recovery, newPassword: undefined, resetTotp: false });
    expect((await tx.select().from(users))[0]!.totpEnrollmentRequired).toBe(false);
  }, { role, ...(role === "WAREHOUSE" ? { passwordHash: null, pinHash: "synthetic-pin-hash" } : {}) });
});

it("enforces bcrypt's existing password limits without logging the rejected password", async () => {
  await withUserFixture(async (tx) => {
    for (const password of ["short", "ქ".repeat(30)]) {
      await expect(recoverUser(tx, { ...recovery, newPassword: password })).rejects.toThrow(/valid password/);
    }
    expect(await tx.select().from(auditLogs)).toHaveLength(0);
  });
});

it("keeps the five-attempt lockout on forced enrollment for a non-admin office user", async () => {
  await withUserFixture(async (tx) => {
    await recoverUser(tx, recovery);
    const setup = await enrollment(tx);
    for (let attempt = 0; attempt < 5; attempt++) {
      await expect(loginOfficeUser(tx, { email, password: newPassword, totpCode: "invalid" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    }
    await expect(loginOfficeUser(tx, { email, password: newPassword, totpCode: generateCurrentTotpToken(setup.base32Secret) })).rejects.toThrow(/locked/);
    expect(await tx.select().from(sessions)).toHaveLength(0);
  }, { role: "OPERATOR", totpEverEnabled: true });
});

it("does not create a PIN session to bypass pending enrollment for an office user who also has a PIN", async () => {
  await withUserFixture(async (tx, id) => {
    await tx.insert(registeredDevices).values({ id: createUuidV7(), deviceName: "Recovery fixture device",
      deviceTokenHash: sha256Hex("synthetic-recovery-device"), registeredBy: id });
    await expect(loginWithWarehousePin(tx, { rawDeviceToken: "synthetic-recovery-device", userId: id, pin: "1234" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(await tx.select().from(sessions)).toHaveLength(1); // Only the pre-existing fixture session.
    expect(await tx.select().from(auditLogs)).toHaveLength(0);
  }, { pinHash: await hashSecret("1234"), totpEnrollmentRequired: true });
});
