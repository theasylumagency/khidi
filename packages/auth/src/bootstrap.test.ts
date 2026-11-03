import { expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { auditLogs, getDb, legalEntities, outboxEvents, registeredDevices, sessions, storefronts, systemSettings, users } from "@khidi/db";
import { AppError } from "@khidi/shared";
import { bootstrapFirstAdmin, generateCurrentTotpToken, loadPrincipalByUserId, loginOfficeUser, verifySecret, verifySessionToken } from "./index.ts";

const db = getDb(), input = { email: "Bootstrap@khidi.example", fullName: "First administrator", password: "Unique-bootstrap-test-password!" };
it("refuses bootstrap if any user already exists, including an inactive user", async () => {
  await expect(bootstrapFirstAdmin(db, input)).rejects.toThrow(/no users/);
  await db.transaction(async (tx) => {
    await tx.execute(sql`CREATE TEMP TABLE users (LIKE public.users INCLUDING ALL) ON COMMIT DROP`);
    await tx.insert(users).values({ id: "01900000-0000-7000-8000-000000000001", fullName: "Inactive", role: "WAREHOUSE", active: false });
    await expect(bootstrapFirstAdmin(tx, input)).rejects.toThrow(/no users/);
    expect(await tx.select().from(users)).toHaveLength(1);
  });
});
it("bootstraps exactly one admin without reference data and issues no session until TOTP is enrolled", async () => {
  await db.transaction(async (tx) => {
    // Real SQL isolation, no deletion/truncation of the seeded catalog or its users.
    for (const name of ["users", "audit_logs", "outbox_events", "sessions"]) await tx.execute(sql.raw(`CREATE TEMP TABLE ${name} (LIKE public.${name} INCLUDING ALL) ON COMMIT DROP`));
    const counts = async () => Promise.all([legalEntities, storefronts, registeredDevices, systemSettings].map((table) => tx.select({ count: sql<number>`count(*)::integer` }).from(table)));
    const before = await counts(), { id } = await bootstrapFirstAdmin(tx, input);
    const [admin] = await tx.select().from(users);
    expect(admin).toMatchObject({ id, email: "bootstrap@khidi.example", role: "ADMIN", totpEnrollmentRequired: true, totpEnabled: false, totpSecretEncrypted: null, pinHash: null });
    expect(await verifySecret(input.password, admin!.passwordHash!)).toBe(true);
    expect(await counts()).toEqual(before);
    await expect(loadPrincipalByUserId(tx, id)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(loginOfficeUser(tx, { ...input, password: "incorrect" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    let enrollment: { base32Secret: string; otpauthUri: string } | undefined;
    try { await loginOfficeUser(tx, input); }
    catch (error) { expect(error).toBeInstanceOf(AppError); enrollment = (error as AppError).details?.totpEnrollment as typeof enrollment; }
    expect(enrollment?.otpauthUri).toContain("Khidi");
    expect(await tx.select().from(sessions)).toHaveLength(0);
    const [pending] = await tx.select().from(users).where(eq(users.id, id));
    expect(pending!.totpSecretEncrypted).not.toContain(enrollment!.base32Secret);
    await expect(loginOfficeUser(tx, { ...input, totpCode: "not-a-code" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const result = await loginOfficeUser(tx, { ...input, totpCode: generateCurrentTotpToken(enrollment!.base32Secret) });
    expect(result.principal).toMatchObject({ userId: id, role: "ADMIN", entityIds: [] });
    expect((await verifySessionToken(tx, result.sessionToken)).userId).toBe(id);
    const [enrolled] = await tx.select().from(users).where(eq(users.id, id));
    expect(enrolled).toMatchObject({ totpEnrollmentRequired: false, totpEnabled: true });
    await expect(loginOfficeUser(tx, input)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const audits = await tx.select().from(auditLogs), events = await tx.select().from(outboxEvents);
    expect(audits.map((row) => row.action)).toEqual(expect.arrayContaining(["FIRST_ADMIN_BOOTSTRAPPED", "TOTP_ENROLLMENT_STARTED", "TOTP_ENROLLMENT_COMPLETED"]));
    expect(events.map((row) => row.eventType)).toContain("FIRST_ADMIN_BOOTSTRAPPED");
    const recorded = JSON.stringify({ audits, events });
    expect(recorded).not.toContain(input.password); expect(recorded).not.toContain(enrollment!.base32Secret); expect(recorded).not.toContain(pending!.totpSecretEncrypted!);
    await expect(bootstrapFirstAdmin(tx, input)).rejects.toThrow(/no users/);
  });
});
