import { and, eq, ne, sql } from "drizzle-orm";
import { users, sessions, type DbExecutor } from "@khidi/db";
import { withDomainTransaction, type DomainTransactionContext } from "@khidi/domain";
import { AppError } from "@khidi/shared";
import { decryptTotpSecret, verifySecret, verifyTotpCode, generateTotpSecret, hashSecret, TOTP_ISSUER } from "./credentials.ts";
import { type AuthenticatedPrincipal } from "./principal.ts";
import { requireOfficeSession, assertRecentStrongAuth } from "./security-session.ts";
import { officePassword } from "./password-policy.ts";

async function failed(ctx: DomainTransactionContext, userId: string) {
  await ctx.tx.update(users).set({ failedLoginAttempts: sql`${users.failedLoginAttempts} + 1`,
    loginLockedUntil: sql`CASE WHEN ${users.failedLoginAttempts} + 1 >= 5 THEN NOW() + INTERVAL '15 minutes' ELSE ${users.loginLockedUntil} END` }).where(eq(users.id, userId));
  await ctx.recordAudit({ action: "STRONG_AUTH_FAILED", entityType: "user", entityId: userId });
  await ctx.emitOutboxEvent({ eventType: "STRONG_AUTH_FAILED", aggregateType: "user", aggregateId: userId, payload: {}, consumers: [] });
}

/** Updates only this session's proof time, never its expiry or creation time. */
export async function reauthenticateWithPasswordTotp(db: DbExecutor, principal: AuthenticatedPrincipal, input: { password: string; totpCode: string }) {
  const ok = await withDomainTransaction(db, { userId: principal.userId }, async (ctx) => {
    const { user, session } = await requireOfficeSession(ctx.tx, principal);
    if (user.loginLockedUntil && user.loginLockedUntil > new Date()) return false;
    if (!await verifySecret(input.password, user.passwordHash!) || !user.totpEnabled || !user.totpSecretEncrypted
      || !verifyTotpCode(decryptTotpSecret(user.totpSecretEncrypted), input.totpCode)) {
      await failed(ctx, user.id); return false;
    }
    await ctx.tx.update(users).set({ failedLoginAttempts: 0, loginLockedUntil: null }).where(eq(users.id, user.id));
    await ctx.tx.update(sessions).set({ lastStrongAuthAt: new Date() }).where(eq(sessions.id, session.id));
    await ctx.recordAudit({ action: "STRONG_AUTH_COMPLETED", entityType: "user", entityId: user.id, after: { method: "PASSWORD_TOTP" } });
    await ctx.emitOutboxEvent({ eventType: "STRONG_AUTH_COMPLETED", aggregateType: "user", aggregateId: user.id, payload: { method: "PASSWORD_TOTP" }, consumers: [] });
    return true;
  });
  if (!ok) throw new AppError("UNAUTHORIZED", "Strong authentication failed.");
}

/** First-ever opt-in needs password proof; replacement additionally needs recent strong auth. */
export async function startOwnTotpEnrollment(db: DbExecutor, principal: AuthenticatedPrincipal, input: { password: string; replace: boolean }) {
  const enrollment = await withDomainTransaction(db, { userId: principal.userId }, async (ctx) => {
    const { user } = input.replace ? await assertRecentStrongAuth(ctx.tx, principal) : await requireOfficeSession(ctx.tx, principal);
    if (!input.replace && (user.totpEnabled || user.totpEverEnabled || user.totpSecretEncrypted)) throw new AppError("FORBIDDEN", "Use the protected TOTP replacement action.");
    if (user.loginLockedUntil && user.loginLockedUntil > new Date()) return null;
    if (!await verifySecret(input.password, user.passwordHash!)) { await failed(ctx, user.id); return null; }
    const secret = generateTotpSecret(user.email!);
    await ctx.tx.update(users).set({ totpSecretEncrypted: secret.encryptedSecret, totpEnabled: false, totpEnrollmentRequired: true,
      totpEverEnabled: user.totpEverEnabled || user.totpEnabled }).where(eq(users.id, user.id));
    // No existing session can outlive the enrollment boundary or become valid again later.
    await ctx.tx.delete(sessions).where(eq(sessions.userId, user.id));
    await ctx.recordAudit({ action: "TOTP_SELF_ENROLLMENT_STARTED", entityType: "user", entityId: user.id, after: { replacement: input.replace } });
    await ctx.emitOutboxEvent({ eventType: "TOTP_SELF_ENROLLMENT_STARTED", aggregateType: "user", aggregateId: user.id, payload: { replacement: input.replace }, consumers: [] });
    return { base32Secret: secret.base32Secret, otpauthUri: secret.otpauthUri, accountLabel: `${TOTP_ISSUER} — ${user.email}` };
  });
  if (!enrollment) throw new AppError("UNAUTHORIZED", "Authentication failed.");
  return enrollment;
}

export async function changeOwnPassword(db: DbExecutor, principal: AuthenticatedPrincipal, password: string) {
  const parsed = officePassword.safeParse(password);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Password must be 12+ characters and at most 72 UTF-8 bytes.");
  const passwordHash = await hashSecret(parsed.data);
  await withDomainTransaction(db, { userId: principal.userId }, async (ctx) => {
    const { user, session } = await assertRecentStrongAuth(ctx.tx, principal);
    await ctx.tx.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, user.id));
    await ctx.tx.delete(sessions).where(and(eq(sessions.userId, user.id), ne(sessions.id, session.id)));
    await ctx.recordAudit({ action: "PASSWORD_CHANGED", entityType: "user", entityId: user.id });
    await ctx.emitOutboxEvent({ eventType: "PASSWORD_CHANGED", aggregateType: "user", aggregateId: user.id, payload: {}, consumers: [] });
  });
}
