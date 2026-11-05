import { randomBytes } from "node:crypto";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import { generateRegistrationOptions, generateAuthenticationOptions, verifyRegistrationResponse, verifyAuthenticationResponse,
  type RegistrationResponseJSON, type AuthenticationResponseJSON, type AuthenticatorTransport } from "@simplewebauthn/server";
import { users, sessions, userPasskeys, webauthnChallenges, type DbExecutor } from "@khidi/db";
import { withDomainTransaction, createDomainTransactionContext, type DomainTransactionContext } from "@khidi/domain";
import { AppError, createUuidV7, sha256Hex } from "@khidi/shared";
import { loadPrincipalByUserId, OFFICE_ROLES, type AuthenticatedPrincipal } from "./principal.ts";
import { assertRecentStrongAuth, requireOfficeSession } from "./security-session.ts";
import { webauthnConfig } from "./webauthn-config.ts";
import { describeRegistrationPlatform } from "./passkey-registration-platform.ts";

type Ceremony = "REGISTER" | "SIGN_IN" | "REAUTH";
const TTL = 5 * 60 * 1000;
const invalid = () => new AppError("UNAUTHORIZED", "Passkey verification failed.");
const userHandle = (id: string) => Buffer.from(id, "utf8").toString("base64url");

async function audit(ctx: DomainTransactionContext, action: "PASSKEY_CHALLENGE_ISSUED" | "PASSKEY_REGISTERED" | "PASSKEY_SIGN_IN" | "PASSKEY_AUTH_FAILED" | "STRONG_AUTH_COMPLETED", ceremony: Ceremony, userId?: string, keyId?: string) {
  const entityId = keyId ?? userId ?? createUuidV7();
  const recorder = action === "PASSKEY_SIGN_IN" ? createDomainTransactionContext(ctx.tx, { userId, correlationId: ctx.correlationId }) : ctx;
  await recorder.recordAudit({ action, entityType: keyId ? "passkey" : "authentication", entityId, after: { ceremony } });
  await ctx.emitOutboxEvent({ eventType: action, aggregateType: "authentication", aggregateId: userId ?? entityId, payload: { ceremony }, consumers: [] });
}

export async function beginPasskeyCeremony(db: DbExecutor, ceremony: Ceremony, principal: AuthenticatedPrincipal | null, sharedDevice = false) {
  if (sharedDevice || (ceremony !== "SIGN_IN" && !principal)) throw invalid();
  const config = webauthnConfig();
  return withDomainTransaction(db, { userId: principal?.userId }, async (ctx) => {
    if (ceremony === "REGISTER") await assertRecentStrongAuth(ctx.tx, principal!);
    else if (ceremony === "REAUTH") await requireOfficeSession(ctx.tx, principal!);
    const keys = principal ? await ctx.tx.select().from(userPasskeys).where(and(eq(userPasskeys.userId, principal.userId), isNull(userPasskeys.revokedAt))) : [];
    const options = ceremony === "REGISTER" ? await generateRegistrationOptions({
      rpName: config.rpName, rpID: config.rpID, userName: principal!.email!, userID: new TextEncoder().encode(principal!.userId),
      attestationType: "none", authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "required", userVerification: "required" },
      excludeCredentials: keys.map((key) => ({ id: key.credentialId, transports: key.transports })), timeout: 60000
    }) : await generateAuthenticationOptions({ rpID: config.rpID, userVerification: "required", timeout: 60000,
      allowCredentials: ceremony === "REAUTH" ? keys.map((key) => ({ id: key.credentialId, transports: key.transports as AuthenticatorTransport[] })) : [] });
    const id = createUuidV7(), bindingToken = randomBytes(32).toString("hex");
    await ctx.tx.insert(webauthnChallenges).values({ id, ceremony, challengeHash: sha256Hex(options.challenge), bindingHash: sha256Hex(bindingToken),
      userId: ceremony === "SIGN_IN" ? null : principal!.userId, sessionId: ceremony === "SIGN_IN" ? null : principal!.sessionId,
      expiresAt: new Date(Date.now() + TTL) });
    await audit(ctx, "PASSKEY_CHALLENGE_ISSUED", ceremony, principal?.userId);
    return { challengeId: id, bindingToken, options };
  });
}

/** Consumption, verification, counter/session writes and audit commit together, including failures. */
export async function finishPasskeyCeremony(db: DbExecutor, input: {
  ceremony: Ceremony; challengeId: string; bindingToken: string; response: RegistrationResponseJSON | AuthenticationResponseJSON;
  principal?: AuthenticatedPrincipal | null; sharedDevice?: boolean; ipAddress?: string; userAgent?: string; desktopIpad?: boolean;
}) {
  if (input.sharedDevice || !z.string().uuid().safeParse(input.challengeId).success || !/^[a-f0-9]{64}$/.test(input.bindingToken)) throw invalid();
  const config = webauthnConfig();
  const outcome = await withDomainTransaction(db, { userId: input.principal?.userId }, async (ctx) => {
    const fail = async () => { await audit(ctx, "PASSKEY_AUTH_FAILED", input.ceremony, input.principal?.userId); return null; };
    // Lock the user before session/challenge/credential, matching recovery's lock order.
    let account: typeof users.$inferSelect | undefined;
    if (input.ceremony !== "SIGN_IN") {
      if (!input.principal) return fail();
      account = (input.ceremony === "REGISTER" ? await assertRecentStrongAuth(ctx.tx, input.principal) : await requireOfficeSession(ctx.tx, input.principal)).user;
    } else if (typeof input.response?.id === "string" && input.response.id.length <= 4096) {
      const [candidate] = await ctx.tx.select({ userId: userPasskeys.userId }).from(userPasskeys).where(eq(userPasskeys.credentialId, input.response.id));
      if (candidate) [account] = await ctx.tx.select().from(users).where(eq(users.id, candidate.userId)).for("update");
    }
    const [challenge] = await ctx.tx.select().from(webauthnChallenges).where(eq(webauthnChallenges.id, input.challengeId)).for("update");
    if (!challenge || challenge.consumedAt || challenge.expiresAt <= new Date() || challenge.ceremony !== input.ceremony
      || challenge.bindingHash !== sha256Hex(input.bindingToken)
      || (input.ceremony !== "SIGN_IN" && (challenge.userId !== input.principal!.userId || challenge.sessionId !== input.principal!.sessionId))) return fail();
    await ctx.tx.update(webauthnChallenges).set({ consumedAt: new Date() }).where(eq(webauthnChallenges.id, challenge.id));
    if (!account?.active || account.totpEnrollmentRequired || !account.email || !account.passwordHash
      || !OFFICE_ROLES.includes(account.role as AuthenticatedPrincipal["role"])) return fail();
    const expectedChallenge = (value: string) => sha256Hex(value) === challenge.challengeHash;

    if (input.ceremony === "REGISTER") {
      let verified;
      try { verified = await verifyRegistrationResponse({ response: input.response as RegistrationResponseJSON,
        expectedChallenge, expectedOrigin: config.origin, expectedRPID: config.rpID, requireUserVerification: true, requireUserPresence: true }); }
      catch { return fail(); }
      if (!verified.verified || !verified.registrationInfo.userVerified) return fail();
      const registration = describeRegistrationPlatform(input.userAgent, input.desktopIpad);
      const info = verified.registrationInfo, id = createUuidV7();
      const inserted = await ctx.tx.insert(userPasskeys).values({ id, userId: account.id, credentialId: info.credential.id,
        publicKey: Buffer.from(info.credential.publicKey).toString("base64url"), signCounter: info.credential.counter,
        transports: info.credential.transports ?? [], backupEligible: info.credentialDeviceType === "multiDevice",
        backedUp: info.credentialBackedUp, displayName: registration.name, registrationPlatform: registration.platform
      }).onConflictDoNothing().returning({ id: userPasskeys.id });
      if (!inserted.length) return fail();
      await audit(ctx, "PASSKEY_REGISTERED", input.ceremony, account.id, id);
      return { passkeyId: id };
    }

    const response = input.response as AuthenticationResponseJSON;
    if (typeof response?.id !== "string" || response.id.length > 4096) return fail();
    const [key] = await ctx.tx.select().from(userPasskeys).where(eq(userPasskeys.credentialId, response.id)).for("update");
    if (!key || key.revokedAt || key.userId !== account.id || (input.ceremony === "REAUTH" && key.userId !== input.principal!.userId)) return fail();
    const handle = response.response?.userHandle;
    if ((input.ceremony === "SIGN_IN" && !handle) || (handle && handle !== userHandle(account.id))) return fail();
    let verified;
    try { verified = await verifyAuthenticationResponse({ response, expectedChallenge, expectedOrigin: config.origin,
      expectedRPID: config.rpID, requireUserVerification: true, credential: { id: key.credentialId,
        publicKey: new Uint8Array(Buffer.from(key.publicKey, "base64url")), counter: key.signCounter,
        transports: key.transports as AuthenticatorTransport[] } }); }
    catch { return fail(); }
    const info = verified.authenticationInfo;
    if (!verified.verified || !info.userVerified || (info.credentialDeviceType === "multiDevice") !== key.backupEligible) return fail();
    const now = new Date();
    await ctx.tx.update(userPasskeys).set({ signCounter: info.newCounter, backedUp: info.credentialBackedUp, lastUsedAt: now }).where(eq(userPasskeys.id, key.id));
    if (input.ceremony === "REAUTH") {
      await ctx.tx.update(sessions).set({ lastStrongAuthAt: now }).where(eq(sessions.id, input.principal!.sessionId!));
      await audit(ctx, "STRONG_AUTH_COMPLETED", input.ceremony, account.id, key.id);
      return { reauthenticated: true };
    }
    const sessionId = createUuidV7(), sessionToken = `khidi_sess_${randomBytes(32).toString("hex")}`;
    await ctx.tx.insert(sessions).values({ id: sessionId, tokenHash: sha256Hex(sessionToken), userId: account.id,
      authMethod: "OFFICE_PASSKEY", passkeyId: key.id, lastStrongAuthAt: now, expiresAt: new Date(now.getTime() + 12 * 60 * 60 * 1000),
      ipAddress: input.ipAddress ?? null, userAgent: input.userAgent ?? null });
    await audit(ctx, "PASSKEY_SIGN_IN", input.ceremony, account.id, key.id);
    const principal = await loadPrincipalByUserId(ctx.tx, account.id, "OFFICE_PASSKEY");
    return { sessionToken, passkeyId: key.id, principal: { ...principal, sessionId, lastStrongAuthAt: now } };
  });
  if (!outcome) throw invalid();
  return outcome;
}

function listActivePasskeys(db: DbExecutor, userId: string) {
  return db.select({
    id: userPasskeys.id, displayName: userPasskeys.displayName, registrationPlatform: userPasskeys.registrationPlatform,
    createdAt: userPasskeys.createdAt, lastUsedAt: userPasskeys.lastUsedAt
  }).from(userPasskeys).where(and(eq(userPasskeys.userId, userId), isNull(userPasskeys.revokedAt))).orderBy(userPasskeys.createdAt);
}

export async function listOwnPasskeys(db: DbExecutor, principal: AuthenticatedPrincipal) {
  return db.transaction(async (tx) => {
    await requireOfficeSession(tx, principal);
    return listActivePasskeys(tx, principal.userId);
  });
}

export async function ownSecurityState(db: DbExecutor, principal: AuthenticatedPrincipal, sharedDevice: boolean) {
  return db.transaction(async (tx) => {
    const { user } = await requireOfficeSession(tx, principal);
    const keys = sharedDevice ? [] : await listActivePasskeys(tx, user.id);
    return { keys, sharedDevice, totpEnabled: user.totpEnabled, canStartTotp: !user.totpEverEnabled && !user.totpEnabled && !user.totpSecretEncrypted };
  });
}

/** Presentation hint only. Call with an ID from a verified, browser-local preference. */
export async function getQuickSignInAccount(db: DbExecutor, keyId: string) {
  const [account] = await db.select({ fullName: users.fullName }).from(userPasskeys)
    .innerJoin(users, eq(users.id, userPasskeys.userId))
    .where(and(eq(userPasskeys.id, keyId), isNull(userPasskeys.revokedAt), eq(users.active, true),
      eq(users.totpEnrollmentRequired, false), isNotNull(users.email), isNotNull(users.passwordHash), inArray(users.role, OFFICE_ROLES)));
  return account ?? null;
}

export async function manageOwnPasskey(db: DbExecutor, principal: AuthenticatedPrincipal, input: { id: string; action: "rename" | "revoke"; displayName?: string }) {
  if (!z.string().uuid().safeParse(input.id).success) throw new AppError("NOT_FOUND", "Passkey not found.");
  return withDomainTransaction(db, { userId: principal.userId }, async (ctx) => {
    await assertRecentStrongAuth(ctx.tx, principal);
    const [key] = await ctx.tx.select().from(userPasskeys).where(and(eq(userPasskeys.id, input.id), eq(userPasskeys.userId, principal.userId), isNull(userPasskeys.revokedAt))).for("update");
    if (!key) throw new AppError("NOT_FOUND", "Passkey not found.");
    if (input.action === "rename") {
      const name = z.string().trim().min(1).max(100).safeParse(input.displayName);
      if (!name.success) throw new AppError("VALIDATION_ERROR", "Passkey name is required.");
      await ctx.tx.update(userPasskeys).set({ displayName: name.data }).where(eq(userPasskeys.id, key.id));
    } else {
      await ctx.tx.update(userPasskeys).set({ revokedAt: new Date() }).where(eq(userPasskeys.id, key.id));
      await ctx.tx.delete(sessions).where(eq(sessions.passkeyId, key.id));
    }
    const action = input.action === "rename" ? "PASSKEY_RENAMED" : "PASSKEY_REVOKED";
    await ctx.recordAudit({ action, entityType: "passkey", entityId: key.id, after: { action: input.action } });
    await ctx.emitOutboxEvent({ eventType: action, aggregateType: "user", aggregateId: principal.userId, payload: {}, consumers: [] });
    return { currentSessionRevoked: input.action === "revoke" && (await ctx.tx.select({ id: sessions.id }).from(sessions).where(eq(sessions.id, principal.sessionId!))).length === 0 };
  });
}
