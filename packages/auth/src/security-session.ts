import { and, eq } from "drizzle-orm";
import { sessions, users, userPasskeys, type DbExecutor } from "@khidi/db";
import { AppError } from "@khidi/shared";
import { OFFICE_ROLES, type AuthenticatedPrincipal } from "./principal.ts";
import { webauthnConfig } from "./webauthn-config.ts";

/** Call inside the mutation transaction: lock user before session, as recovery does. */
export async function requireOfficeSession(tx: DbExecutor, principal: AuthenticatedPrincipal) {
  const [user] = await tx.select().from(users).where(eq(users.id, principal.userId)).for("update");
  if (!user?.active || user.totpEnrollmentRequired || !OFFICE_ROLES.includes(user.role as typeof principal.role)
    || !user.email || !user.passwordHash || !principal.sessionId || principal.authMethod === "WAREHOUSE_PIN"
    || principal.role !== user.role) throw new AppError("FORBIDDEN", "An active office session is required.");
  const [session] = await tx.select().from(sessions).where(and(eq(sessions.id, principal.sessionId), eq(sessions.userId, user.id))).for("update");
  if (!session || session.expiresAt <= new Date() || session.authMethod === "WAREHOUSE_PIN") throw new AppError("UNAUTHORIZED", "Office session expired.");
  if (session.authMethod === "OFFICE_PASSKEY") {
    const [key] = session.passkeyId ? await tx.select().from(userPasskeys).where(eq(userPasskeys.id, session.passkeyId)) : [];
    if (!key || key.revokedAt || key.userId !== user.id) throw new AppError("UNAUTHORIZED", "Session credential revoked.");
  }
  return { user, session };
}

export async function assertRecentStrongAuth(tx: DbExecutor, principal: AuthenticatedPrincipal) {
  const context = await requireOfficeSession(tx, principal);
  const timestamp = context.session.lastStrongAuthAt?.getTime();
  const now = Date.now();
  if (!timestamp || timestamp > now || now - timestamp > webauthnConfig().recentWindowMs) {
    throw new AppError("RECENT_AUTH_REQUIRED", "Recent strong authentication is required.");
  }
  return context;
}
