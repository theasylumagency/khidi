import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import * as OTPAuth from "otpauth";
import { eq, sql } from "drizzle-orm";
import {
  type AppDatabase,
  users,
  userEntityMemberships,
  userPermissions,
  registeredDevices,
  sessions,
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

const BCRYPT_ROUNDS = 10;
const OFFICE_SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const WAREHOUSE_PIN_SESSION_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours short session (§13.2)
const MAX_PIN_ATTEMPTS = 5;
const MAX_LOGIN_ATTEMPTS = 5;
const TOTP_ISSUER = "Khidi";
const DEFAULT_DEV_TOTP_KEY_HEX =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

export interface AuthenticatedPrincipal {
  userId: string;
  email: string | null;
  fullName: string;
  role: UserRole;
  locale: SupportedLocale;
  entityIds: string[];
  permissions: GranularPermission[];
  authMethod: "OFFICE_PASSWORD_TOTP" | "WAREHOUSE_PIN";
  deviceId: string | null;
}

export async function hashSecret(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifySecret(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

function resolveTotpEncryptionKey(explicitKey?: string): Buffer {
  const rawKey = explicitKey ?? process.env.HUB_TOTP_ENCRYPTION_KEY ?? DEFAULT_DEV_TOTP_KEY_HEX;
  if (/^[0-9a-fA-F]{64}$/.test(rawKey)) {
    return Buffer.from(rawKey, "hex");
  }
  return createHash("sha256").update(rawKey, "utf8").digest();
}

/**
 * Encrypts a Base32 TOTP secret using AES-256-GCM before storing in `users.totp_secret_encrypted`.
 * Format: `v1:<iv_hex>:<auth_tag_hex>:<ciphertext_hex>`
 */
export function encryptTotpSecret(plainBase32Secret: string, explicitKey?: string): string {
  const key = resolveTotpEncryptionKey(explicitKey);
  const iv = randomBytes(12); // 96-bit IV for AES-GCM
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plainBase32Secret.trim(), "utf8"),
    cipher.final()
  ]);
  const authTag = cipher.getAuthTag();
  return `v1:${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Decrypts `users.totp_secret_encrypted` using AES-256-GCM.
 */
export function decryptTotpSecret(encryptedPayload: string, explicitKey?: string): string {
  const parts = encryptedPayload.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new AppError(
      "UNAUTHORIZED",
      "Stored TOTP secret is not in valid v1 AES-256-GCM encrypted format."
    );
  }
  const [, ivHex, tagHex, cipherHex] = parts;
  if (!ivHex || !tagHex || !cipherHex) {
    throw new AppError("UNAUTHORIZED", "Malformed encrypted TOTP secret payload.");
  }

  try {
    const key = resolveTotpEncryptionKey(explicitKey);
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(ivHex, "hex")
    );
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(cipherHex, "hex")),
      decipher.final()
    ]);
    return decrypted.toString("utf8");
  } catch {
    throw new AppError("UNAUTHORIZED", "Failed to decrypt TOTP secret (invalid encryption key or corrupted tag).");
  }
}

export function generateTotpSecret(email: string): {
  base32Secret: string;
  encryptedSecret: string;
  otpauthUri: string;
} {
  const secret = new OTPAuth.Secret({ size: 20 });
  const totp = new OTPAuth.TOTP({
    issuer: TOTP_ISSUER,
    label: email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret
  });
  return {
    base32Secret: secret.base32,
    encryptedSecret: encryptTotpSecret(secret.base32),
    otpauthUri: totp.toString()
  };
}

export function generateCurrentTotpToken(base32Secret: string, timestampMs: number = Date.now()): string {
  const totp = new OTPAuth.TOTP({
    issuer: TOTP_ISSUER,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(base32Secret)
  });
  return totp.generate({ timestamp: timestampMs });
}

export function verifyTotpCode(base32Secret: string, code: string, timestampMs: number = Date.now()): boolean {
  const totp = new OTPAuth.TOTP({
    issuer: TOTP_ISSUER,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(base32Secret)
  });
  const delta = totp.validate({ token: code.trim(), timestamp: timestampMs, window: 1 });
  return delta !== null;
}

export function roleRequiresMandatoryTotp(role: UserRole): boolean {
  return role === "ADMIN" || role === "STOCK_MANAGER";
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

export async function loadPrincipalByUserId(
  db: AppDatabase,
  userId: string,
  authMethod: "OFFICE_PASSWORD_TOTP" | "WAREHOUSE_PIN" = "OFFICE_PASSWORD_TOTP",
  deviceId: string | null = null
): Promise<AuthenticatedPrincipal> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user || !user.active) {
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

async function recordAtomicOfficeLoginFailure(db: AppDatabase, userId: string): Promise<void> {
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
  db: AppDatabase,
  input: {
    email: string;
    password: string;
    totpCode?: string;
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
  if (roleRequiresMandatoryTotp(role) || user.totpEnabled) {
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

  const principal = await loadPrincipalByUserId(db, user.id, "OFFICE_PASSWORD_TOTP", null);
  return { sessionToken: rawSessionToken, principal };
}

/**
 * Device Registration & Revocation by ADMIN for shared warehouse phones (§13.2).
 */
export async function registerWarehouseDevice(
  db: AppDatabase,
  adminPrincipal: AuthenticatedPrincipal,
  input: { deviceName: string }
): Promise<{ deviceId: string; deviceName: string; rawDeviceToken: string }> {
  assertRoleAllowed(adminPrincipal, ["ADMIN"]);

  const rawDeviceToken = `khidi_dev_${randomBytes(32).toString("hex")}`;
  const deviceTokenHash = sha256Hex(rawDeviceToken);
  const deviceId = createUuidV7();

  await withDomainTransaction(db, { userId: adminPrincipal.userId }, async (ctx) => {
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
  db: AppDatabase,
  adminPrincipal: AuthenticatedPrincipal,
  input: { deviceId: string; reason: string }
): Promise<void> {
  assertRoleAllowed(adminPrincipal, ["ADMIN"]);

  await withDomainTransaction(db, { userId: adminPrincipal.userId }, async (ctx) => {
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
  db: AppDatabase,
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
  if (!user || !user.active || !user.pinHash) {
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

  const principal = await loadPrincipalByUserId(db, user.id, "WAREHOUSE_PIN", device.id);
  return { sessionToken: rawSessionToken, principal };
}

export async function verifySessionToken(
  db: AppDatabase,
  rawSessionToken: string
): Promise<AuthenticatedPrincipal> {
  const tokenHash = sha256Hex(rawSessionToken);
  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.tokenHash, tokenHash))
    .limit(1);

  if (!session || session.expiresAt <= new Date()) {
    throw new AppError("UNAUTHORIZED", "Session expired or invalid.");
  }

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

  return loadPrincipalByUserId(
    db,
    session.userId,
    session.authMethod as "OFFICE_PASSWORD_TOTP" | "WAREHOUSE_PIN",
    session.deviceId
  );
}

export async function revokeSessionToken(
  db: AppDatabase,
  rawSessionToken: string
): Promise<void> {
  const tokenHash = sha256Hex(rawSessionToken);
  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.tokenHash, tokenHash))
    .limit(1);

  if (!session) {
    return;
  }

  await withDomainTransaction(db, { userId: session.userId }, async (ctx) => {
    await ctx.tx.delete(sessions).where(eq(sessions.id, session.id));
    await ctx.recordAudit({
      action: "USER_LOGOUT",
      entityType: "user",
      entityId: session.userId,
      after: { sessionId: session.id, authMethod: session.authMethod }
    });
  });
}

/**
 * Returns minimal PIN-switcher user cards (id, fullName, role — never email) ONLY when
 * the request presents a valid, active registered warehouse device token.
 */
export async function listPinEnabledUsersForRegisteredDevice(
  db: AppDatabase,
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
export async function issueStorefrontApiKey(
  db: AppDatabase,
  adminPrincipal: AuthenticatedPrincipal,
  input: {
    storefrontId: string;
    name: string;
    allowedIps?: string[];
  }
): Promise<{ id: string; keyPrefix: string; rawApiKey: string }> {
  assertRoleAllowed(adminPrincipal, ["ADMIN"]);

  const [storefront] = await db
    .select()
    .from(storefronts)
    .where(eq(storefronts.id, input.storefrontId))
    .limit(1);

  if (!storefront) {
    throw new AppError("NOT_FOUND", `Storefront ${input.storefrontId} not found.`);
  }

  const randomPart = randomBytes(24).toString("hex");
  const keyPrefix = `sf_${storefront.key.replace(/[^a-z0-9]/g, "").slice(0, 10)}`;
  const rawApiKey = `${keyPrefix}_${randomPart}`;
  const keyHash = sha256Hex(rawApiKey);
  const id = createUuidV7();

  await withDomainTransaction(db, { userId: adminPrincipal.userId }, async (ctx) => {
    await ctx.tx.insert(storefrontApiKeys).values({
      id,
      storefrontId: storefront.id,
      name: input.name.trim(),
      keyPrefix,
      keyHash,
      allowedIps: input.allowedIps ?? null,
      active: true,
      createdBy: adminPrincipal.userId
    });

    await ctx.recordAudit({
      action: "STOREFRONT_API_KEY_ISSUED",
      entityType: "storefront_api_key",
      entityId: id,
      after: { storefrontId: storefront.id, name: input.name.trim(), keyPrefix }
    });
  });

  return { id, keyPrefix, rawApiKey };
}

export async function verifyStorefrontServiceCredential(
  db: AppDatabase,
  input: {
    requestedStorefrontKey: string;
    rawApiKey: string;
    clientIp?: string;
  }
): Promise<{ storefrontId: string; storefrontKey: string; sellerEntityId: string }> {
  const keyHash = sha256Hex(input.rawApiKey);

  const [keyRow] = await db
    .select({
      keyId: storefrontApiKeys.id,
      keyActive: storefrontApiKeys.active,
      revokedAt: storefrontApiKeys.revokedAt,
      expiresAt: storefrontApiKeys.expiresAt,
      allowedIps: storefrontApiKeys.allowedIps,
      storefrontId: storefronts.id,
      storefrontKey: storefronts.key,
      storefrontActive: storefronts.active,
      sellerEntityId: storefronts.sellerEntityId
    })
    .from(storefrontApiKeys)
    .innerJoin(storefronts, eq(storefrontApiKeys.storefrontId, storefronts.id))
    .where(eq(storefrontApiKeys.keyHash, keyHash))
    .limit(1);

  if (!keyRow || !keyRow.keyActive || keyRow.revokedAt || !keyRow.storefrontActive) {
    throw new AppError("UNAUTHORIZED", "Invalid or revoked storefront service credential.");
  }

  if (keyRow.expiresAt && keyRow.expiresAt <= new Date()) {
    throw new AppError("UNAUTHORIZED", "Storefront service credential has expired.");
  }

  // Strict storefront scope check: credential for Storefront A can never access Storefront B (§12, §17.1)
  if (keyRow.storefrontKey !== input.requestedStorefrontKey) {
    throw new AppError(
      "FORBIDDEN",
      `Storefront credential is scoped to "${keyRow.storefrontKey}" and cannot access "${input.requestedStorefrontKey}".`
    );
  }

  if (keyRow.allowedIps && keyRow.allowedIps.length > 0) {
    if (!input.clientIp || !keyRow.allowedIps.includes(input.clientIp)) {
      throw new AppError("FORBIDDEN", "Client IP is not on the storefront credential allowlist.");
    }
  }

  await db
    .update(storefrontApiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(storefrontApiKeys.id, keyRow.keyId));

  return {
    storefrontId: keyRow.storefrontId,
    storefrontKey: keyRow.storefrontKey,
    sellerEntityId: keyRow.sellerEntityId
  };
}

export async function listUsersWithMemberships(
  db: AppDatabase,
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
    active: u.active,
    entityIds: allMemberships.filter((m) => m.userId === u.id).map((m) => m.legalEntityId),
    permissions: allPermissions
      .filter((p) => p.userId === u.id)
      .map((p) => p.permissionKey as GranularPermission),
    createdAt: u.createdAt
  }));
}
