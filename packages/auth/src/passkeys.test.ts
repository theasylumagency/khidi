import { expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { getDb, users, sessions, userPasskeys, webauthnChallenges, auditLogs } from "@khidi/db";
import { createUuidV7, sha256Hex } from "@khidi/shared";
import { assertTestDatabaseSafety } from "../../db/src/test-database-safety.ts";
import { hashSecret, generateTotpSecret, generateCurrentTotpToken } from "./credentials.ts";
import { verifySessionToken, loginOfficeUser } from "./index.ts";
import { beginPasskeyCeremony, finishPasskeyCeremony, listOwnPasskeys, manageOwnPasskey } from "./passkeys.ts";
import { reauthenticateWithPasswordTotp, startOwnTotpEnrollment, changeOwnPassword } from "./account-security.ts";
import { recoverUser } from "./recovery.ts";
import { authenticator } from "./passkey-fixtures.test-helper.ts";

const password = "Synthetic-passkey-test-password";
async function fixture(weak = false, warehouse = false) {
  assertTestDatabaseSafety();
  const db = getDb();
  const target = await db.execute(sql`SELECT current_database() AS name`);
  if (!String(target.rows[0]?.name).endsWith("_test")) throw new Error("SAFETY: Passkey fixtures require an actual _test database.");
  const id = createUuidV7(), sessionId = createUuidV7(), token = `khidi_sess_${createUuidV7()}`, secret = generateTotpSecret(`fixture-${id}@khidi.example`);
  const email = `fixture-${id}@khidi.example`;
  await db.insert(users).values({ id, email, fullName: "Passkey fixture", role: warehouse ? "WAREHOUSE" : "OPERATOR", passwordHash: await hashSecret(password),
    totpEnabled: !weak, totpEverEnabled: !weak, totpSecretEncrypted: weak ? null : secret.encryptedSecret });
  await db.insert(sessions).values({ id: sessionId, tokenHash: sha256Hex(token), userId: id,
    authMethod: warehouse ? "WAREHOUSE_PIN" : "OFFICE_PASSWORD_TOTP", lastStrongAuthAt: weak || warehouse ? null : new Date(), expiresAt: new Date(Date.now() + 3600000) });
  return { db, id, email, token, sessionId, secret: secret.base32Secret, principal: await verifySessionToken(db, token) };
}

async function registered(f: Awaited<ReturnType<typeof fixture>>, key = authenticator()) {
  const start = await beginPasskeyCeremony(f.db, "REGISTER", f.principal);
  const result = await finishPasskeyCeremony(f.db, { ceremony: "REGISTER", challengeId: start.challengeId, bindingToken: start.bindingToken,
    principal: f.principal, response: key.registration(start.options.challenge), displayName: "Fixture passkey" });
  return { key, keyId: result.passkeyId! };
}
async function signIn(f: Awaited<ReturnType<typeof fixture>>, key: ReturnType<typeof authenticator>, counter = 1) {
  const start = await beginPasskeyCeremony(f.db, "SIGN_IN", null);
  return finishPasskeyCeremony(f.db, { ceremony: "SIGN_IN", challengeId: start.challengeId, bindingToken: start.bindingToken,
    response: key.assertion(start.options.challenge, f.id, counter) });
}

it("verifies real registration/assertion signatures, stores only credential essentials and issues a strong office session", async () => {
  const f = await fixture(), { key, keyId } = await registered(f);
  const result = await signIn(f, key);
  expect(result.sessionToken).toBeDefined();
  const principal = await verifySessionToken(f.db, result.sessionToken!);
  expect(principal).toMatchObject({ userId: f.id, authMethod: "OFFICE_PASSKEY" });
  expect(principal.lastStrongAuthAt).toBeInstanceOf(Date);
  const [stored] = await f.db.select().from(userPasskeys).where(eq(userPasskeys.id, keyId));
  expect(stored).toMatchObject({ userId: f.id, signCounter: 1, backupEligible: false, backedUp: false });
  expect((await listOwnPasskeys(f.db, principal))[0]).not.toHaveProperty("credentialId");
  const audits = await f.db.select().from(auditLogs).where(eq(auditLogs.actorUserId, f.id));
  expect(audits.some((a) => a.action === "PASSKEY_REGISTERED")).toBe(true);
  expect(JSON.stringify(audits)).not.toContain(key.id);
});

it.each(["origin", "rp", "uv", "challenge", "binding", "expired", "cross-user", "type"])("rejects %s during registration", async (kind) => {
  const f = await fixture(), key = authenticator(), start = await beginPasskeyCeremony(f.db, "REGISTER", f.principal);
  if (kind === "expired") await f.db.update(webauthnChallenges).set({ createdAt: new Date(Date.now() - 600000), expiresAt: new Date(Date.now() - 1000) }).where(eq(webauthnChallenges.id, start.challengeId));
  const response = key.registration(kind === "challenge" ? "unrelated-challenge" : start.options.challenge,
    { origin: kind === "origin" ? "https://other.example" : undefined, rpID: kind === "rp" ? "other.example" : undefined, uv: kind !== "uv" });
  const principal = kind === "cross-user" ? (await fixture()).principal : f.principal;
  await expect(finishPasskeyCeremony(f.db, { ceremony: kind === "type" ? "REAUTH" : "REGISTER", principal,
    challengeId: start.challengeId, bindingToken: kind === "binding" ? "f".repeat(64) : start.bindingToken, response })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  expect(await listOwnPasskeys(f.db, f.principal)).toHaveLength(0);
});

it("rejects weak, stale, warehouse-PIN and shared-browser registration", async () => {
  const weak = await fixture(true), stale = await fixture(), pin = await fixture(true, true);
  await stale.db.update(sessions).set({ lastStrongAuthAt: new Date(Date.now() - 700000), createdAt: new Date() }).where(eq(sessions.id, stale.sessionId));
  for (const f of [weak, stale]) await expect(beginPasskeyCeremony(f.db, "REGISTER", f.principal)).rejects.toMatchObject({ code: "RECENT_AUTH_REQUIRED" });
  await expect(beginPasskeyCeremony(pin.db, "REGISTER", { ...pin.principal, lastStrongAuthAt: new Date() })).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(beginPasskeyCeremony(stale.db, "SIGN_IN", null, true)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
});

it("does not rebind duplicate credential IDs or reuse a registration challenge", async () => {
  const a = await fixture(), b = await fixture(), first = await registered(a);
  const start = await beginPasskeyCeremony(b.db, "REGISTER", b.principal);
  const input = { ceremony: "REGISTER" as const, principal: b.principal, challengeId: start.challengeId, bindingToken: start.bindingToken, response: first.key.registration(start.options.challenge) };
  await expect(finishPasskeyCeremony(b.db, input)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  await expect(finishPasskeyCeremony(b.db, input)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  const [key] = await b.db.select().from(userPasskeys).where(eq(userPasskeys.id, first.keyId));
  expect(key!.userId).toBe(a.id);
});

it.each(["origin", "rp", "uv", "handle", "revoked", "inactive", "counter", "signature"])("rejects %s during sign-in", async (kind) => {
  const f = await fixture(), { key, keyId } = await registered(f);
  if (kind === "counter") await signIn(f, key, 2);
  if (kind === "revoked") await f.db.update(userPasskeys).set({ revokedAt: new Date() }).where(eq(userPasskeys.id, keyId));
  if (kind === "inactive") await f.db.update(users).set({ active: false }).where(eq(users.id, f.id));
  const start = await beginPasskeyCeremony(f.db, "SIGN_IN", null);
  const response = key.assertion(start.options.challenge, kind === "handle" ? createUuidV7() : f.id, 1,
    { origin: kind === "origin" ? "https://other.example" : undefined, rpID: kind === "rp" ? "other.example" : undefined, uv: kind !== "uv" });
  if (kind === "signature") response.response.signature = authenticator().assertion(start.options.challenge, f.id).response.signature;
  await expect(finishPasskeyCeremony(f.db, { ceremony: "SIGN_IN", challengeId: start.challengeId, bindingToken: start.bindingToken,
    response })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  const [consumed] = await f.db.select().from(webauthnChallenges).where(eq(webauthnChallenges.id, start.challengeId));
  expect(consumed!.consumedAt).toBeInstanceOf(Date);
});

it("consumes a challenge once under concurrent assertion replay", async () => {
  const f = await fixture(), { key, keyId } = await registered(f), start = await beginPasskeyCeremony(f.db, "SIGN_IN", null);
  const input = { ceremony: "SIGN_IN" as const, challengeId: start.challengeId, bindingToken: start.bindingToken, response: key.assertion(start.options.challenge, f.id) };
  const results = await Promise.allSettled([finishPasskeyCeremony(f.db, input), finishPasskeyCeremony(f.db, input)]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(await f.db.select().from(sessions).where(eq(sessions.passkeyId, keyId))).toHaveLength(1);
});

it("lists/manages only own credentials and revocation immediately invalidates passkey sessions", async () => {
  const a = await fixture(), b = await fixture(), one = await registered(a), two = await registered(b);
  expect((await listOwnPasskeys(a.db, a.principal)).map((k) => k.id)).toEqual([one.keyId]);
  await expect(manageOwnPasskey(a.db, a.principal, { id: two.keyId, action: "revoke" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  await manageOwnPasskey(a.db, a.principal, { id: one.keyId, action: "rename", displayName: "Renamed" });
  const signed = await signIn(a, one.key);
  await manageOwnPasskey(a.db, a.principal, { id: one.keyId, action: "revoke" });
  await expect(verifySessionToken(a.db, signed.sessionToken!)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  expect(await listOwnPasskeys(a.db, a.principal)).toHaveLength(0);
});

it("refreshes strong proof through password+TOTP and a passkey without extending the existing session", async () => {
  const f = await fixture(), { key } = await registered(f);
  const [before] = await f.db.select().from(sessions).where(eq(sessions.id, f.sessionId));
  await f.db.update(sessions).set({ lastStrongAuthAt: new Date(Date.now() - 700000) }).where(eq(sessions.id, f.sessionId));
  await reauthenticateWithPasswordTotp(f.db, f.principal, { password, totpCode: generateCurrentTotpToken(f.secret) });
  const start = await beginPasskeyCeremony(f.db, "REAUTH", f.principal);
  await finishPasskeyCeremony(f.db, { ceremony: "REAUTH", principal: f.principal, challengeId: start.challengeId, bindingToken: start.bindingToken, response: key.assertion(start.options.challenge, f.id) });
  const [after] = await f.db.select().from(sessions).where(eq(sessions.id, f.sessionId));
  expect(after!.expiresAt).toEqual(before!.expiresAt); expect(after!.createdAt).toEqual(before!.createdAt);
  expect(after!.lastStrongAuthAt!.getTime()).toBeGreaterThan(Date.now() - 5000);
  await expect(reauthenticateWithPasswordTotp(f.db, (await fixture(true, true)).principal, { password, totpCode: "000000" })).rejects.toMatchObject({ code: "FORBIDDEN" });
});

it("allows first TOTP opt-in for an optional office user, but protects replacement and password changes", async () => {
  const f = await fixture(true);
  await expect(startOwnTotpEnrollment(f.db, f.principal, { password: "incorrect", replace: false })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  expect((await f.db.select().from(users).where(eq(users.id, f.id)))[0]!.failedLoginAttempts).toBe(1);
  const setup = await startOwnTotpEnrollment(f.db, f.principal, { password, replace: false });
  await expect(verifySessionToken(f.db, f.token)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  const login = await loginOfficeUser(f.db, { email: f.email, password, totpCode: generateCurrentTotpToken(setup.base32Secret) });
  await registered({ ...f, principal: login.principal });
  await expect(startOwnTotpEnrollment(f.db, login.principal, { password, replace: false })).rejects.toMatchObject({ code: "FORBIDDEN" });
  await f.db.update(sessions).set({ lastStrongAuthAt: null }).where(eq(sessions.id, login.principal.sessionId!));
  await expect(startOwnTotpEnrollment(f.db, login.principal, { password, replace: true })).rejects.toMatchObject({ code: "RECENT_AUTH_REQUIRED" });
  await expect(changeOwnPassword(f.db, login.principal, "Synthetic-new-test-password")).rejects.toMatchObject({ code: "RECENT_AUTH_REQUIRED" });
});

it("break-glass revokes all keys atomically and never prints/stores raw credential data in audit", async () => {
  const f = await fixture(), { key } = await registered(f), login = await signIn(f, key);
  const result = await recoverUser(f.db, { email: f.email, confirmationEmail: f.email, resetTotp: false, revokeSessions: false, revokePasskeys: true, note: "Lost passkeys; authorized server recovery." });
  expect(result.passkeysRevoked).toBe(1);
  await expect(verifySessionToken(f.db, login.sessionToken!)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  const audit = await f.db.select().from(auditLogs).where(and(eq(auditLogs.entityId, f.id), eq(auditLogs.action, "USER_RECOVERY_PERFORMED")));
  expect(audit).toHaveLength(1); expect(JSON.stringify(audit)).not.toContain(key.id);
});

it("consumes successful registration and refuses expired or replayed sign-in proofs", async () => {
  const f = await fixture(), key = authenticator(), start = await beginPasskeyCeremony(f.db, "REGISTER", f.principal);
  const input = { ceremony: "REGISTER" as const, principal: f.principal, challengeId: start.challengeId, bindingToken: start.bindingToken,
    response: key.registration(start.options.challenge), displayName: "Fixture" };
  await finishPasskeyCeremony(f.db, input);
  await expect(finishPasskeyCeremony(f.db, input)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  const expired = await beginPasskeyCeremony(f.db, "SIGN_IN", null);
  await f.db.update(webauthnChallenges).set({ createdAt: new Date(Date.now() - 600000), expiresAt: new Date(Date.now() - 1000) }).where(eq(webauthnChallenges.id, expired.challengeId));
  await expect(finishPasskeyCeremony(f.db, { ceremony: "SIGN_IN", challengeId: expired.challengeId, bindingToken: expired.bindingToken,
    response: key.assertion(expired.options.challenge, f.id) })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
});

it("never accepts another account's passkey or session as reauthentication", async () => {
  const a = await fixture(), b = await fixture(), { key } = await registered(b);
  const start = await beginPasskeyCeremony(a.db, "REAUTH", a.principal);
  await expect(finishPasskeyCeremony(a.db, { ceremony: "REAUTH", principal: a.principal, challengeId: start.challengeId,
    bindingToken: start.bindingToken, response: key.assertion(start.options.challenge, b.id) })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  const own = await registered(a), bound = await beginPasskeyCeremony(a.db, "REAUTH", a.principal), secondSession = await signIn(a, own.key);
  await expect(finishPasskeyCeremony(a.db, { ceremony: "REAUTH", principal: secondSession.principal, challengeId: bound.challengeId,
    bindingToken: bound.bindingToken, response: own.key.assertion(bound.options.challenge, a.id, 2) })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
});

it("requires persisted recent proof for key management and preserves expiry when changing the password", async () => {
  const f = await fixture(), { key, keyId } = await registered(f), other = await signIn(f, key);
  await f.db.update(sessions).set({ lastStrongAuthAt: new Date(Date.now() - 700000) }).where(eq(sessions.id, f.sessionId));
  await expect(manageOwnPasskey(f.db, { ...f.principal, lastStrongAuthAt: new Date() }, { id: keyId, action: "revoke" })).rejects.toMatchObject({ code: "RECENT_AUTH_REQUIRED" });
  await reauthenticateWithPasswordTotp(f.db, f.principal, { password, totpCode: generateCurrentTotpToken(f.secret) });
  const [before] = await f.db.select().from(sessions).where(eq(sessions.id, f.sessionId));
  await changeOwnPassword(f.db, f.principal, "Synthetic-changed-office-password");
  const [after] = await f.db.select().from(sessions).where(eq(sessions.id, f.sessionId));
  expect(after).toEqual(before);
  await expect(verifySessionToken(f.db, other.sessionToken!)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  await expect(loginOfficeUser(f.db, { email: f.email, password, totpCode: generateCurrentTotpToken(f.secret) })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  expect((await loginOfficeUser(f.db, { email: f.email, password: "Synthetic-changed-office-password", totpCode: generateCurrentTotpToken(f.secret) })).principal.lastStrongAuthAt).toBeInstanceOf(Date);
});

it("commits failed reauthentication lockouts and enforces credential invariants in PostgreSQL", async () => {
  const f = await fixture(), { keyId } = await registered(f);
  for (let i = 0; i < 5; i++) await expect(reauthenticateWithPasswordTotp(f.db, f.principal, { password: "incorrect", totpCode: "000000" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  await expect(reauthenticateWithPasswordTotp(f.db, f.principal, { password, totpCode: generateCurrentTotpToken(f.secret) })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  expect((await f.db.select().from(users).where(eq(users.id, f.id)))[0]!.failedLoginAttempts).toBe(5);
  const other = await fixture();
  await expect(f.db.update(userPasskeys).set({ userId: other.id }).where(eq(userPasskeys.id, keyId))).rejects.toThrow();
  await expect(f.db.delete(userPasskeys).where(eq(userPasskeys.id, keyId))).rejects.toThrow();
  const pin = await fixture(true, true);
  await expect(f.db.update(sessions).set({ lastStrongAuthAt: new Date() }).where(eq(sessions.id, pin.sessionId))).rejects.toThrow();
});
