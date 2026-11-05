import { eq } from "drizzle-orm";
import { users, userEntityMemberships, userPermissions, type AppDatabase, type DbExecutor } from "@khidi/db";
import { AppError, type UserRole, type GranularPermission, type SupportedLocale } from "@khidi/shared";
import type { SessionTiming } from "./session-timing.ts";
export type AuthMethod = "OFFICE_PASSWORD_TOTP" | "OFFICE_PASSKEY" | "WAREHOUSE_PIN";
export const OFFICE_ROLES: UserRole[] = ["ADMIN", "STOCK_MANAGER", "OPERATOR", "ORDER_MANAGER"];
export interface AuthenticatedPrincipal {
  userId: string;
  email: string | null;
  fullName: string;
  role: UserRole;
  locale: SupportedLocale;
  entityIds: string[];
  permissions: GranularPermission[];
  authMethod: AuthMethod;
  deviceId: string | null;
  sessionId?: string;
  lastStrongAuthAt?: Date | null;
  sessionTiming?: SessionTiming;
}
export async function loadPrincipalByUserId(
  db: AppDatabase | DbExecutor,
  userId: string,
  authMethod: AuthMethod = "OFFICE_PASSWORD_TOTP",
  deviceId: string | null = null
): Promise<AuthenticatedPrincipal> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user || !user.active || user.totpEnrollmentRequired) {
    throw new AppError("UNAUTHORIZED", "User is not active or does not exist.");
  }

  const memberships = await db
    .select()
    .from(userEntityMemberships)
    .where(eq(userEntityMemberships.userId, user.id));

  const perms = await db
    .select()
    .from(userPermissions)
    .where(eq(userPermissions.userId, user.id));

  return {
    userId: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role as UserRole,
    locale: (user.locale as SupportedLocale) ?? "ka",
    entityIds: memberships.map((m) => m.legalEntityId),
    permissions: perms.map((p) => p.permissionKey as GranularPermission),
    authMethod,
    deviceId
  };
}
