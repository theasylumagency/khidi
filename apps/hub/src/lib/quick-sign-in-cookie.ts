import { createHmac, timingSafeEqual } from "node:crypto";
import { resolveEncryptionKeyBuffer } from "@khidi/shared";

export const QUICK_SIGN_IN_COOKIE = "khidi_quick_sign_in";
export const QUICK_SIGN_IN_DEFERRED_COOKIE = "khidi_quick_sign_in_deferred";
const maxAge = 180 * 24 * 60 * 60;
export const quickSignInCookieOptions = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge };
type Mode = "key" | "named" | "deferred";

function signature(payload: string) {
  return createHmac("sha256", resolveEncryptionKeyBuffer()).update("khidi-quick-sign-in-v1:").update(payload).digest();
}

export function signQuickSignInPreference(mode: Mode, id: string) {
  const payload = `${mode}.${id}.${Math.floor(Date.now() / 1000) + maxAge}`;
  return `${payload}.${signature(payload).toString("hex")}`;
}

export function readQuickSignInPreference(value?: string) {
  // Ignore legacy "offered" cookies because they were issued before the user saw the offer.
  const match = value?.match(/^(key|named|deferred)\.([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\.(\d{10})\.([0-9a-f]{64})$/);
  if (!match) return null;
  const [, mode, id, expiry, digest] = match as [string, Mode, string, string, string];
  if (Number(expiry) <= Math.floor(Date.now() / 1000) || !timingSafeEqual(Buffer.from(digest, "hex"), signature(`${mode}.${id}.${expiry}`))) return null;
  return { mode, id };
}
