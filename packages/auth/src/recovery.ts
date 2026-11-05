import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { users, sessions, type DbExecutor } from "@khidi/db";
import { withDomainTransaction } from "@khidi/domain";
import { AppError } from "@khidi/shared";
import { officePassword } from "./password-policy.ts";

type RecoveryUser = Pick<typeof users.$inferSelect,
  "role" | "email" | "passwordHash" | "totpEnabled" | "totpEverEnabled" | "totpEnrollmentRequired">;

export function hasOfficeLogin(user: RecoveryUser): boolean {
  return ["ADMIN", "STOCK_MANAGER", "OPERATOR", "ORDER_MANAGER"].includes(user.role)
    && Boolean(user.email && user.passwordHash);
}

export function canResetTotpForRecovery(user: RecoveryUser): boolean {
  return hasOfficeLogin(user) && (user.role === "ADMIN" || user.role === "STOCK_MANAGER"
    || user.totpEnabled || user.totpEverEnabled);
}

export async function inspectRecoveryUser(db: DbExecutor, email: string) {
  const [user] = await db.select().from(users).where(eq(users.email, email.trim().toLowerCase())).limit(1);
  if (!user?.active) throw new AppError("NOT_FOUND", "User does not exist or is inactive. No changes were made.");
  return { email: user.email!, canResetTotp: canResetTotpForRecovery(user), canSetPassword: hasOfficeLogin(user) };
}

const recoveryInput = z.object({
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  confirmationEmail: z.string().trim().email().transform((value) => value.toLowerCase()),
  resetTotp: z.boolean(), newPassword: officePassword.optional(), revokeSessions: z.boolean(),
  note: z.string().trim().min(1).max(2000)
}).strict();

export interface RecoveryInput {
  email: string;
  confirmationEmail: string;
  resetTotp: boolean;
  newPassword?: string;
  revokeSessions: boolean;
  note: string;
}

/** Server operator only. No prompts, environment reads, logging, or web route. */
export async function recoverUser(db: DbExecutor, input: RecoveryInput) {
  const parsed = recoveryInput.safeParse(input);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "A valid email, confirmation, operator note and valid password (if selected) are required.");
  const data = parsed.data;
  if (data.email !== data.confirmationEmail) throw new AppError("VALIDATION_ERROR", "Email confirmation does not match. No changes were made.");
  if (!data.resetTotp && data.newPassword === undefined && !data.revokeSessions) throw new AppError("VALIDATION_ERROR", "Select at least one recovery action.");
  const passwordHash = data.newPassword === undefined ? undefined : await bcrypt.hash(data.newPassword, 10);

  return withDomainTransaction(db, {}, async (ctx) => {
    const [user] = await ctx.tx.select().from(users).where(eq(users.email, data.email)).for("update");
    if (!user?.active) throw new AppError("NOT_FOUND", "User does not exist or is inactive. No changes were made.");
    if (data.resetTotp && !canResetTotpForRecovery(user)) throw new AppError("FORBIDDEN", "TOTP reset is not available for this user.");
    if (passwordHash && !hasOfficeLogin(user)) throw new AppError("FORBIDDEN", "Password recovery requires an existing office login.");

    await ctx.tx.update(users).set({
      ...(passwordHash ? { passwordHash } : {}),
      ...(data.resetTotp ? { totpSecretEncrypted: null, totpEnabled: false, totpEnrollmentRequired: true,
        totpEverEnabled: user.totpEverEnabled || user.totpEnabled } : {}),
      updatedAt: new Date()
    }).where(eq(users.id, user.id));
    const revoked = data.revokeSessions
      ? await ctx.tx.delete(sessions).where(eq(sessions.userId, user.id)).returning({ id: sessions.id }) : [];
    const actions = { resetTotp: data.resetTotp, passwordChanged: Boolean(passwordHash), revokeSessions: data.revokeSessions };
    await ctx.recordAudit({ action: "USER_RECOVERY_PERFORMED", entityType: "user", entityId: user.id,
      after: { actions, sessionsRevoked: revoked.length }, reason: data.note });
    await ctx.emitOutboxEvent({ eventType: "USER_RECOVERY_PERFORMED", aggregateType: "user", aggregateId: user.id,
      payload: { actions, sessionsRevoked: revoked.length }, consumers: [] });
    return { userId: user.id, actions, sessionsRevoked: revoked.length };
  });
}
