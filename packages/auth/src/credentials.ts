import bcrypt from "bcryptjs";
import * as OTPAuth from "otpauth";
import { encryptSecretAes256Gcm, decryptSecretAes256Gcm, type UserRole } from "@khidi/shared";
const BCRYPT_ROUNDS = 10;
export const TOTP_ISSUER = "Khidi";
export async function hashSecret(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifySecret(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * Encrypts a Base32 TOTP secret using AES-256-GCM (`@khidi/shared`) before storing in `users.totp_secret_encrypted`.
 * Format: `v1:<iv_hex>:<auth_tag_hex>:<ciphertext_hex>`
 */
export function encryptTotpSecret(
  plainBase32Secret: string,
  explicitKey?: string,
  env: NodeJS.ProcessEnv = process.env
): string {
  return encryptSecretAes256Gcm(plainBase32Secret, explicitKey, env);
}

/**
 * Decrypts `users.totp_secret_encrypted` using AES-256-GCM (`@khidi/shared`).
 */
export function decryptTotpSecret(
  encryptedPayload: string,
  explicitKey?: string,
  env: NodeJS.ProcessEnv = process.env
): string {
  return decryptSecretAes256Gcm(encryptedPayload, explicitKey, env);
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
  return role === "ADMIN" || role === "STOCK_MANAGER" || role === "CATALOG_REVIEWER";
}
