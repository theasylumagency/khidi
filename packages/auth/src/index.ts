import { decryptTotpSecret, verifySecret, verifyTotpCode, generateTotpSecret, roleRequiresMandatoryTotp, TOTP_ISSUER } from "./credentials.ts";
import { loadPrincipalByUserId, type AuthenticatedPrincipal, type AuthMethod } from "./principal.ts";
import { assertRecentStrongAuth } from "./security-session.ts";
import { sessionTiming, sessionIdleLimitMs, SESSION_ACTIVITY_INTERVAL_MS } from "./session-timing.ts";
export type { SessionTiming } from "./session-timing.ts";
export * from "./credentials.ts";
export * from "./principal.ts";
export * from "./security-session.ts";
export { webauthnConfig } from "./webauthn-config.ts";
export * from "./passkeys.ts";
export type { RegistrationResponseJSON, AuthenticationResponseJSON } from "@simplewebauthn/server";
export * from "./account-security.ts";
export { securityRequestFingerprint } from "./security-fingerprint.ts";

import { randomBytes } from "node:crypto";
import * as OTPAuth from "otpauth";
import { and, eq, sql } from "drizzle-orm";
import {
  type AppDatabase,
  type DbExecutor,
  users,
  userEntityMemberships,
  userPermissions,
  registeredDevices,
  sessions,
  userPasskeys,
  storefronts,
  storefrontApiKeys
} from "@khidi/db";
import { withDomainTransaction } from "@khidi/domain";
import {
  AppError,
  createUuidV7,
  sha256Hex,
  type GranularPermission,
  type SupportedLocale,
  type UserRole
} from "@khidi/shared";

const OFFICE_SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const WAREHOUSE_PIN_SESSION_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours short session (§13.2)
const MAX_PIN_ATTEMPTS = 5;
const MAX_LOGIN_ATTEMPTS = 5;
export { bootstrapFirstAdmin } from "./bootstrap.ts";
export { recoverUser, inspectRecoveryUser, canResetTotpForRecovery } from "./recovery.ts";

/** Known device tokens remain shared-browser markers even after device revocation. */
export async function isWarehouseBrowser(db: DbExecutor, rawDeviceToken: string | undefined): Promise<boolean> {
  if (!rawDeviceToken) return false;
  return (await db.select({ id: registeredDevices.id }).from(registeredDevices).where(eq(registeredDevices.deviceTokenHash, sha256Hex(rawDeviceToken))).limit(1)).length > 0;
}

/**
 * RBAC and Entity Isolation Rules (§13.1, [C12]).
 */
export function canAccessAdminScreens(principal: AuthenticatedPrincipal): boolean {
  return principal.role === "ADMIN";
}

export function canViewPrices(principal: AuthenticatedPrincipal): boolean {
  if (principal.role === "WAREHOUSE") {
    return false;
  }
  return (
    principal.role === "ADMIN" ||
    principal.role === "OPERATOR" ||
    principal.permissions.includes("price.edit")
  );
}

export function canEditPrices(principal: AuthenticatedPrincipal): boolean {
  if (principal.role === "WAREHOUSE") {
    return false;
  }
  return principal.role === "ADMIN" || principal.permissions.includes("price.edit");
}

export function canViewCommercialInvoices(principal: AuthenticatedPrincipal): boolean {
  return principal.role === "ADMIN";
}

export function canPerformCrossEntityTransfer(principal: AuthenticatedPrincipal): boolean {
  return (
    principal.role === "ADMIN" ||
    principal.permissions.includes("stock.transfer.cross_entity")
  );
}

export function canAccessEntityData(principal: AuthenticatedPrincipal, legalEntityId: string): boolean {
  if (principal.role === "ADMIN") {
    return true;
  }
  return principal.entityIds.includes(legalEntityId);
}

export function canManageEntityStock(principal: AuthenticatedPrincipal, legalEntityId: string): boolean {
  if (principal.role === "ADMIN") {
    return true;
  }
  if (principal.role === "STOCK_MANAGER") {
    return principal.entityIds.includes(legalEntityId);
  }
  return false;
}

export function assertRoleAllowed(principal: AuthenticatedPrincipal, allowedRoles: UserRole[]): void {
  if (!allowedRoles.includes(principal.role)) {
    throw new AppError(
      "FORBIDDEN",
      `Role ${principal.role} is not permitted for this operation.`
    );
  }
}

export function assertEntityAccess(principal: AuthenticatedPrincipal, legalEntityId: string): void {
  if (!canAccessEntityData(principal, legalEntityId)) {
    throw new AppError(
      "FORBIDDEN",
      `User ${principal.userId} (${principal.role}) does not have access to legal entity ${legalEntityId}.`
    );
  }
}

export function assertEntityStockManagement(principal: AuthenticatedPrincipal, legalEntityId: string): void {
  if (!canManageEntityStock(principal, legalEntityId)) {
    throw new AppError(
      "FORBIDDEN",
      `User ${principal.userId} (${principal.role}) cannot manage stock for legal entity ${legalEntityId}.`
    );
  }
}

export function assertPriceViewAccess(principal: AuthenticatedPrincipal): void {
  if (!canViewPrices(principal)) {
    throw new AppError("FORBIDDEN", `Role ${principal.role} cannot view price data.`);
  }
}

export function assertPriceEditAccess(principal: AuthenticatedPrincipal): void {
  if (!canEditPrices(principal)) {
    throw new AppError("FORBIDDEN", `User ${principal.userId} is not permitted to edit prices.`);
  }
}

async function recordAtomicOfficeLoginFailure(
  db: AppDatabase | DbExecutor,
  userId: string
): Promise<void> {
  await db
    .update(users)
    .set({
      failedLoginAttempts: sql`${users.failedLoginAttempts} + 1`,
      loginLockedUntil: sql`CASE WHEN ${users.failedLoginAttempts} + 1 >= ${MAX_LOGIN_ATTEMPTS} THEN NOW() + INTERVAL '15 minutes' ELSE ${users.loginLockedUntil} END`
    })
    .where(eq(users.id, userId));
}

/**
 * Office Login: Email + Password + Mandatory TOTP for ADMIN and STOCK_MANAGER (§13.2).
 * Enforces atomic brute-force lockout (`failed_login_attempts`, `login_locked_until`) and AES-256-GCM TOTP decryption.
 */
export async function loginOfficeUser(
  db: AppDatabase | DbExecutor,
  input: {
    email: string;
    password: string;
    totpCode?: string;
    restartEnrollment?: boolean;
    ipAddress?: string;
    userAgent?: string;
  }
): Promise<{ sessionToken: string; principal: AuthenticatedPrincipal }> {
  const normalizedEmail = input.email.trim().toLowerCase();
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, normalizedEmail))
    .limit(1);

  if (!user || !user.active || !user.passwordHash) {
    throw new AppError("UNAUTHORIZED", "Invalid email or password.");
  }

  if (user.loginLockedUntil && user.loginLockedUntil > new Date()) {
    throw new AppError(
      "UNAUTHORIZED",
      "Account login is temporarily locked due to repeated failed attempts."
    );
  }

  const passwordValid = await verifySecret(input.password, user.passwordHash);
  if (!passwordValid) {
    await recordAtomicOfficeLoginFailure(db, user.id);
    throw new AppError("UNAUTHORIZED", "Invalid email or password.");
  }

  const role = user.role as UserRole;
  if (input.restartEnrollment && (!user.totpEnrollmentRequired || input.totpCode)) {
    throw new AppError("UNAUTHORIZED", "Only unfinished TOTP enrollment can be restarted.");
  }
  if (user.totpEnrollmentRequired && (!user.totpSecretEncrypted || !input.totpCode || input.restartEnrollment)) {
    const enrollment = await withDomainTransaction(db, { userId: user.id }, async (ctx) => {
      const [current] = await ctx.tx.select().from(users).where(eq(users.id, user.id)).for("update");
      if (!current?.active || !current.totpEnrollmentRequired || current.passwordHash !== user.passwordHash) throw new AppError("UNAUTHORIZED", "Please sign in again.");
      if (current.totpSecretEncrypted && !input.restartEnrollment) {
        const base32Secret = decryptTotpSecret(current.totpSecretEncrypted);
        const totp = new OTPAuth.TOTP({ issuer: TOTP_ISSUER, label: current.email!, secret: OTPAuth.Secret.fromBase32(base32Secret) });
        return { base32Secret, otpauthUri: totp.toString(), accountLabel: `${TOTP_ISSUER} — ${current.email}` };
      }
      const secret = generateTotpSecret(current.email!);
      await ctx.tx.update(users).set({ totpSecretEncrypted: secret.encryptedSecret }).where(eq(users.id, current.id));
      const action = input.restartEnrollment ? "TOTP_ENROLLMENT_RESTARTED" : "TOTP_ENROLLMENT_STARTED";
      await ctx.recordAudit({ action, entityType: "user", entityId: current.id, after: { enrollmentRequired: true } });
      await ctx.emitOutboxEvent({ eventType: action, aggregateType: "user", aggregateId: current.id, payload: {}, consumers: [] });
      return { base32Secret: secret.base32Secret, otpauthUri: secret.otpauthUri, accountLabel: `${TOTP_ISSUER} — ${current.email}` };
    });
    throw new AppError("PRECONDITION_FAILED", "TOTP enrollment is required before a session can be issued.", { totpEnrollment: enrollment });
  }
  if (roleRequiresMandatoryTotp(role) || user.totpEnabled || user.totpEnrollmentRequired) {
    if (!user.totpSecretEncrypted) {
      throw new AppError(
        "UNAUTHORIZED",
        `Mandatory TOTP is required for role ${role}, but TOTP is not configured.`
      );
    }
    const decryptedBase32 = decryptTotpSecret(user.totpSecretEncrypted);
    if (!input.totpCode || !verifyTotpCode(decryptedBase32, input.totpCode)) {
      await recordAtomicOfficeLoginFailure(db, user.id);
      throw new AppError("UNAUTHORIZED", "Invalid or missing TOTP verification code.");
    }
  }

  const rawSessionToken = `khidi_sess_${randomBytes(32).toString("hex")}`;
  const tokenHash = sha256Hex(rawSessionToken);
  const expiresAt = new Date(Date.now() + OFFICE_SESSION_TTL_MS);

  await withDomainTransaction(db, { userId: user.id }, async (ctx) => {
    const [current] = await ctx.tx.select().from(users).where(eq(users.id, user.id)).for("update");
    if (!current?.active || current.passwordHash !== user.passwordHash || current.role !== user.role
      || current.totpSecretEncrypted !== user.totpSecretEncrypted || current.totpEnabled !== user.totpEnabled
      || current.totpEnrollmentRequired !== user.totpEnrollmentRequired
      || (current.loginLockedUntil && current.loginLockedUntil > new Date())) throw new AppError("UNAUTHORIZED", "Please sign in again.");
    if (current.totpEnrollmentRequired) {
      if (!current.totpSecretEncrypted || !input.totpCode || !verifyTotpCode(decryptTotpSecret(current.totpSecretEncrypted), input.totpCode)) throw new AppError("UNAUTHORIZED", "TOTP enrollment must be confirmed.");
      await ctx.tx.update(users).set({ totpEnrollmentRequired: false, totpEnabled: true, totpEverEnabled: true }).where(eq(users.id, current.id));
      await ctx.recordAudit({ action: "TOTP_ENROLLMENT_COMPLETED", entityType: "user", entityId: current.id, after: { totpEnabled: true } });
      await ctx.emitOutboxEvent({ eventType: "TOTP_ENROLLMENT_COMPLETED", aggregateType: "user", aggregateId: current.id, payload: {}, consumers: [] });
    }
    await ctx.tx
      .update(users)
      .set({ failedLoginAttempts: 0, loginLockedUntil: null })
      .where(eq(users.id, user.id));

    await ctx.tx.insert(sessions).values({
      id: createUuidV7(),
      tokenHash,
      userId: user.id,
      deviceId: null,
      authMethod: "OFFICE_PASSWORD_TOTP",
      lastStrongAuthAt: roleRequiresMandatoryTotp(role) || user.totpEnabled || user.totpEnrollmentRequired ? new Date() : null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      expiresAt
    });

    await ctx.recordAudit({
      action: "USER_LOGIN_OFFICE",
      entityType: "user",
      entityId: user.id,
      after: { role: user.role, authMethod: "OFFICE_PASSWORD_TOTP" }
    });
  });

  const principal = await verifySessionToken(db, rawSessionToken);
  return { sessionToken: rawSessionToken, principal };
}

/**
 * Device Registration & Revocation by ADMIN for shared warehouse phones (§13.2).
 */
export async function registerWarehouseDevice(
  db: AppDatabase | DbExecutor,
  adminPrincipal: AuthenticatedPrincipal,
  input: { deviceName: string }
): Promise<{ deviceId: string; deviceName: string; rawDeviceToken: string }> {
  assertRoleAllowed(adminPrincipal, ["ADMIN"]);

  const rawDeviceToken = `khidi_dev_${randomBytes(32).toString("hex")}`;
  const deviceTokenHash = sha256Hex(rawDeviceToken);
  const deviceId = createUuidV7();

  await withDomainTransaction(db, { userId: adminPrincipal.userId }, async (ctx) => {
    await assertRecentStrongAuth(ctx.tx, adminPrincipal);
    await ctx.tx.insert(registeredDevices).values({
      id: deviceId,
      deviceName: input.deviceName.trim(),
      deviceTokenHash,
      registeredBy: adminPrincipal.userId,
      active: true
    });

    await ctx.recordAudit({
      action: "WAREHOUSE_DEVICE_REGISTERED",
      entityType: "registered_device",
      entityId: deviceId,
      after: { deviceName: input.deviceName.trim() }
    });
  });

  return { deviceId, deviceName: input.deviceName.trim(), rawDeviceToken };
}

export async function revokeWarehouseDevice(
  db: AppDatabase | DbExecutor,
  adminPrincipal: AuthenticatedPrincipal,
  input: { deviceId: string; reason: string }
): Promise<void> {
  assertRoleAllowed(adminPrincipal, ["ADMIN"]);

  await withDomainTransaction(db, { userId: adminPrincipal.userId }, async (ctx) => {
    await assertRecentStrongAuth(ctx.tx, adminPrincipal);
    await ctx.tx
      .update(registeredDevices)
      .set({ active: false, revokedAt: new Date() })
      .where(eq(registeredDevices.id, input.deviceId));

    await ctx.tx.delete(sessions).where(eq(sessions.deviceId, input.deviceId));

    await ctx.recordAudit({
      action: "WAREHOUSE_DEVICE_REVOKED",
      entityType: "registered_device",
      entityId: input.deviceId,
      reason: input.reason
    });
  });
}

/**
 * Warehouse Shared-Device PIN Login & Quick User Switch (§13.2).
 * Uses atomic SQL increment for `failed_pin_attempts` and `pin_locked_until`.
 */
export async function loginWithWarehousePin(
  db: AppDatabase | DbExecutor,
  input: {
    rawDeviceToken: string;
    userId: string;
    pin: string;
    ipAddress?: string;
    userAgent?: string;
  }
): Promise<{ sessionToken: string; principal: AuthenticatedPrincipal }> {
  const deviceTokenHash = sha256Hex(input.rawDeviceToken);
  const [device] = await db
    .select()
    .from(registeredDevices)
    .where(eq(registeredDevices.deviceTokenHash, deviceTokenHash))
    .limit(1);

  if (!device || !device.active || device.revokedAt) {
    throw new AppError(
      "UNAUTHORIZED",
      "This device is not registered or has been revoked by an administrator."
    );
  }

  const [user] = await db.select().from(users).where(eq(users.id, input.userId)).limit(1);
  if (!user || !user.active || !user.pinHash || user.totpEnrollmentRequired) {
    throw new AppError("UNAUTHORIZED", "Warehouse PIN is not enabled for this user.");
  }

  if (user.pinLockedUntil && user.pinLockedUntil > new Date()) {
    throw new AppError("UNAUTHORIZED", "PIN is temporarily locked due to failed attempts.");
  }

  const pinValid = await verifySecret(input.pin, user.pinHash);
  if (!pinValid) {
    // Atomic increment in PostgreSQL (no read-modify-write race)
    await db
      .update(users)
      .set({
        failedPinAttempts: sql`${users.failedPinAttempts} + 1`,
        pinLockedUntil: sql`CASE WHEN ${users.failedPinAttempts} + 1 >= ${MAX_PIN_ATTEMPTS} THEN NOW() + INTERVAL '15 minutes' ELSE ${users.pinLockedUntil} END`
      })
      .where(eq(users.id, user.id));

    throw new AppError("UNAUTHORIZED", "Invalid personal PIN.");
  }

  const rawSessionToken = `khidi_wsess_${randomBytes(32).toString("hex")}`;
  const tokenHash = sha256Hex(rawSessionToken);
  const expiresAt = new Date(Date.now() + WAREHOUSE_PIN_SESSION_TTL_MS);

  await withDomainTransaction(db, { userId: user.id }, async (ctx) => {
    const [current] = await ctx.tx.select().from(users).where(eq(users.id,user.id)).for("update");
    const [currentDevice] = await ctx.tx.select().from(registeredDevices).where(eq(registeredDevices.id,device.id)).for("update");
    if(!current?.active || current.totpEnrollmentRequired || current.pinHash!==user.pinHash
      || !currentDevice?.active || currentDevice.revokedAt
      || current.pinLockedUntil && current.pinLockedUntil>new Date()) throw new AppError("UNAUTHORIZED","Please sign in again.");
    await ctx.tx
      .update(users)
      .set({ failedPinAttempts: 0, pinLockedUntil: null })
      .where(eq(users.id, user.id));

    await ctx.tx
      .update(registeredDevices)
      .set({ lastSeenAt: new Date() })
      .where(eq(registeredDevices.id, device.id));

    await ctx.tx.insert(sessions).values({
      id: createUuidV7(),
      tokenHash,
      userId: user.id,
      deviceId: device.id,
      authMethod: "WAREHOUSE_PIN",
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      expiresAt
    });

    await ctx.recordAudit({
      action: "USER_LOGIN_WAREHOUSE_PIN",
      entityType: "user",
      entityId: user.id,
      after: { deviceId: device.id, deviceName: device.deviceName }
    });
  });

  const principal = await verifySessionToken(db, rawSessionToken);
  return { sessionToken: rawSessionToken, principal };
}

export async function verifySessionToken(
  db: AppDatabase | DbExecutor,
  rawSessionToken: string
): Promise<AuthenticatedPrincipal> {
  const tokenHash = sha256Hex(rawSessionToken);
  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.tokenHash, tokenHash))
    .limit(1);

  if (!session) throw new AppError("UNAUTHORIZED", "Session expired or invalid.");
  return verifyStoredSession(db, session);
}

async function verifyStoredSession(db: DbExecutor, session: typeof sessions.$inferSelect): Promise<AuthenticatedPrincipal> {
  sessionTiming(session);

  if (session.deviceId) {
    const [device] = await db
      .select()
      .from(registeredDevices)
      .where(eq(registeredDevices.id, session.deviceId))
      .limit(1);
    if (!device || !device.active || device.revokedAt) {
      throw new AppError("UNAUTHORIZED", "Registered device has been revoked.");
    }
  }

  if (!["OFFICE_PASSWORD_TOTP", "OFFICE_PASSKEY", "WAREHOUSE_PIN"].includes(session.authMethod)) throw new AppError("UNAUTHORIZED", "Invalid session method.");
  if (session.authMethod === "OFFICE_PASSKEY") {
    const [key] = await db.select().from(userPasskeys).where(eq(userPasskeys.id, session.passkeyId!));
    if (!key || key.revokedAt || key.userId !== session.userId) throw new AppError("UNAUTHORIZED", "Session credential revoked.");
  }
  const principal = await loadPrincipalByUserId(db, session.userId, session.authMethod as AuthMethod, session.deviceId);
  return { ...principal, sessionId: session.id, lastStrongAuthAt: session.lastStrongAuthAt, sessionTiming: sessionTiming(session) };
}

/** A compare-and-set on disposable session metadata. A stale revision can read, but never renew. */
export async function renewSessionActivity(db: DbExecutor, rawSessionToken: string, sessionId: string, lastActivityAtMs: number) {
  return db.transaction(async (tx) => {
    const [session] = await tx.select().from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.tokenHash, sha256Hex(rawSessionToken)))).for("update");
    if (!session) throw new AppError("UNAUTHORIZED", "Session expired or invalid.");
    const principal = await verifyStoredSession(tx, session);
    if (session.lastActivityAt.getTime() !== lastActivityAtMs) return principal.sessionTiming!;
    // This statement starts AFTER the row lock, so waiting cannot preserve an earlier timestamp.
    const now = sql`statement_timestamp()`;
    const idleMs = sessionIdleLimitMs(session.authMethod);
    const [updated] = await tx.update(sessions).set({ lastActivityAt: now }).where(and(
      eq(sessions.id, session.id),
      sql`${sessions.expiresAt} > ${now}`,
      sql`${sessions.lastActivityAt} > ${now} - (${idleMs} * interval '1 millisecond')`,
      sql`${sessions.lastActivityAt} <= ${now} - (${SESSION_ACTIVITY_INTERVAL_MS} * interval '1 millisecond')`
    )).returning();
    return sessionTiming(updated ?? session);
  });
}

export async function revokeSessionToken(
  db: AppDatabase | DbExecutor,
  rawSessionToken: string,
  expectedSessionId?: string
): Promise<boolean> {
  const tokenHash = sha256Hex(rawSessionToken);
  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.tokenHash, tokenHash))
    .limit(1);

  if (!session) {
    return false;
  }
  if (expectedSessionId && expectedSessionId !== session.id) return false;

  await withDomainTransaction(db, { userId: session.userId }, async (ctx) => {
    await ctx.tx.delete(sessions).where(eq(sessions.id, session.id));
    await ctx.recordAudit({
      action: "USER_LOGOUT",
      entityType: "user",
      entityId: session.userId,
      after: { sessionId: session.id, authMethod: session.authMethod }
    });
  });
  return true;
}

/**
 * Returns minimal PIN-switcher user cards (id, fullName, role — never email) ONLY when
 * the request presents a valid, active registered warehouse device token.
 */
export async function listPinEnabledUsersForRegisteredDevice(
  db: AppDatabase | DbExecutor,
  rawDeviceToken: string
): Promise<{
  device: { id: string; deviceName: string };
  users: Array<{ id: string; fullName: string; role: UserRole }>;
} | null> {
  const deviceTokenHash = sha256Hex(rawDeviceToken);
  const [device] = await db
    .select()
    .from(registeredDevices)
    .where(eq(registeredDevices.deviceTokenHash, deviceTokenHash))
    .limit(1);

  if (!device || !device.active || device.revokedAt) {
    return null;
  }

  const allUsers = await db.select().from(users).orderBy(users.fullName);
  const pinUsers = allUsers
    .filter((u) => u.active && Boolean(u.pinHash))
    .map((u) => ({
      id: u.id,
      fullName: u.fullName,
      role: u.role as UserRole
    }));

  return {
    device: { id: device.id, deviceName: device.deviceName },
    users: pinUsers
  };
}

/**
 * Scoped Storefront Service Key issuance and verification (§12.1, §16.2).
 */
export async function listUsersWithMemberships(
  db: AppDatabase | DbExecutor,
  adminPrincipal: AuthenticatedPrincipal
) {
  assertRoleAllowed(adminPrincipal, ["ADMIN"]);

  const allUsers = await db.select().from(users).orderBy(users.fullName);
  const allMemberships = await db.select().from(userEntityMemberships);
  const allPermissions = await db.select().from(userPermissions);

  return allUsers.map((u) => ({
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    role: u.role as UserRole,
    locale: u.locale as SupportedLocale,
    totpEnabled: u.totpEnabled,
    hasPin: Boolean(u.pinHash),
    setupPending: !u.passwordHash && !u.pinHash,
    totpEnrollmentRequired: u.totpEnrollmentRequired,
    active: u.active,
    entityIds: allMemberships.filter((m) => m.userId === u.id).map((m) => m.legalEntityId),
    permissions: allPermissions
      .filter((p) => p.userId === u.id)
      .map((p) => p.permissionKey as GranularPermission),
    createdAt: u.createdAt
  }));
}

export * from "./storefront-service.ts";

export * from "./user-management.ts";
