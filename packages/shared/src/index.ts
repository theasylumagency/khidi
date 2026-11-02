import { randomBytes, createHash, createCipheriv, createDecipheriv } from "node:crypto";
import { z } from "zod";
import { createUuidV7 } from "./uuid.ts";
export { createUuidV7 } from "./uuid.ts";

export const DEFAULT_DEV_TOTP_KEY_HEX =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

export function resolveEncryptionKeyBuffer(
  explicitKey?: string,
  env: NodeJS.ProcessEnv = process.env
): Buffer {
  const envKey = env.HUB_TOTP_ENCRYPTION_KEY?.trim();

  if (!explicitKey && env.NODE_ENV === "production") {
    if (!envKey) {
      throw new Error(
        "CRITICAL: HUB_TOTP_ENCRYPTION_KEY environment variable is required in production."
      );
    }
    if (envKey.toLowerCase() === DEFAULT_DEV_TOTP_KEY_HEX) {
      throw new Error(
        "CRITICAL: HUB_TOTP_ENCRYPTION_KEY must not use the default repository development key in production."
      );
    }
  }

  const rawKey = explicitKey ?? envKey ?? DEFAULT_DEV_TOTP_KEY_HEX;
  if (/^[0-9a-fA-F]{64}$/.test(rawKey)) {
    return Buffer.from(rawKey, "hex");
  }
  return createHash("sha256").update(rawKey, "utf8").digest();
}

/**
 * Single canonical AES-256-GCM secret encryption helper (`HUB_TOTP_ENCRYPTION_KEY`).
 * Output format: `v1:<iv_hex>:<auth_tag_hex>:<ciphertext_hex>`
 */
export function encryptSecretAes256Gcm(
  plaintext: string,
  explicitKey?: string,
  env: NodeJS.ProcessEnv = process.env
): string {
  const key = resolveEncryptionKeyBuffer(explicitKey, env);
  const iv = randomBytes(12); // 96-bit IV for AES-GCM
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext.trim(), "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `v1:${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Single canonical AES-256-GCM secret decryption helper.
 */
export function decryptSecretAes256Gcm(
  encryptedPayload: string,
  explicitKey?: string,
  env: NodeJS.ProcessEnv = process.env
): string {
  const parts = encryptedPayload.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new AppError(
      "UNAUTHORIZED",
      "Stored secret is not in valid v1 AES-256-GCM encrypted format."
    );
  }
  const [, ivHex, tagHex, cipherHex] = parts;
  if (!ivHex || !tagHex || !cipherHex) {
    throw new AppError("UNAUTHORIZED", "Malformed encrypted secret payload.");
  }

  const key = resolveEncryptionKeyBuffer(explicitKey, env);

  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(cipherHex, "hex")),
      decipher.final()
    ]);
    return decrypted.toString("utf8");
  } catch {
    throw new AppError(
      "UNAUTHORIZED",
      "Failed to decrypt secret (invalid encryption key or corrupted authentication tag)."
    );
  }
}

/**
 * RFC 9562 UUIDv7 generator (monotonic millisecond timestamp + cryptographic random bits).
 */
export function createCorrelationId(): string {
  return `cor_${createUuidV7()}`;
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Money in integer minor units (tetri) with explicit GEL currency (§3.4).
 */
export const CURRENCY_GEL = "GEL" as const;
export type CurrencyCode = typeof CURRENCY_GEL;

export interface MoneyMinor {
  readonly amountMinor: number;
  readonly currency: CurrencyCode;
}

export function tetri(amountMinor: number): MoneyMinor {
  if (!Number.isSafeInteger(amountMinor)) {
    throw new AppError(
      "VALIDATION_ERROR",
      `Money must be an integer in tetri, received: ${String(amountMinor)}`
    );
  }
  return { amountMinor, currency: CURRENCY_GEL };
}

export function parseLariToTetri(lariInput: string): number {
  const trimmed = lariInput.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    throw new AppError("VALIDATION_ERROR", `Invalid GEL amount format: "${lariInput}"`);
  }
  const [wholePart = "0", fracPart = ""] = trimmed.split(".");
  const paddedFrac = fracPart.padEnd(2, "0");
  const result = Number(wholePart) * 100 + Number(paddedFrac);
  if (!Number.isSafeInteger(result)) {
    throw new AppError("VALIDATION_ERROR", `Amount out of safe integer range: "${lariInput}"`);
  }
  return result;
}

export function formatTetri(amountMinor: number): string {
  if (!Number.isSafeInteger(amountMinor)) {
    throw new AppError("VALIDATION_ERROR", "amountMinor must be a safe integer");
  }
  const sign = amountMinor < 0 ? "-" : "";
  const abs = Math.abs(amountMinor);
  const lari = Math.floor(abs / 100);
  const rem = String(abs % 100).padStart(2, "0");
  return `${sign}${lari}.${rem} ₾`;
}

/**
 * UTC storage and Asia/Tbilisi display helpers (§3.4).
 */
export const TBILISI_TIMEZONE = "Asia/Tbilisi" as const;

export function nowUtc(): Date {
  return new Date();
}

export function formatTbilisiDateTime(date: Date | string, locale: "ka" | "en" = "ka"): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const intlLocale = locale === "ka" ? "ka-GE" : "en-GB";
  return new Intl.DateTimeFormat(intlLocale, {
    timeZone: TBILISI_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(d);
}

/**
 * Standardized domain errors.
 */
export type ErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "CONFLICT"
  | "PRECONDITION_FAILED"
  | "INVARIANT_VIOLATION"
  | "IDEMPOTENCY_CONFLICT";

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
  }
}

/**
 * Core Roles, Relationship Modes, and Zod Schemas (§4.4, §13.1, [C12]).
 */
export const USER_ROLES = [
  "ADMIN",
  "OPERATOR",
  "STOCK_MANAGER",
  "WAREHOUSE",
  "ORDER_MANAGER"
] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const GRANULAR_PERMISSIONS = [
  "price.edit",
  "stock.transfer.cross_entity",
  "product.approve",
  "evidence.view_invoices"
] as const;

export type GranularPermission = (typeof GRANULAR_PERMISSIONS)[number];

export const RELATIONSHIP_MODES = ["PURCHASE", "CONSIGNMENT"] as const;
export type RelationshipMode = (typeof RELATIONSHIP_MODES)[number];

export const LOCALES = ["ka", "en"] as const;
export type SupportedLocale = (typeof LOCALES)[number];

export const uuidSchema = z.string().uuid();
export const roleSchema = z.enum(USER_ROLES);
export const localeSchema = z.enum(LOCALES);
export const relationshipModeSchema = z.enum(RELATIONSHIP_MODES);
export const positiveTetriSchema = z.number().int().positive();
export const idempotencyKeySchema = z.string().min(8).max(128);
