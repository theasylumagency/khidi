import { createHmac } from "node:crypto";
import { resolveEncryptionKeyBuffer } from "@khidi/shared";

/** Idempotency must not persist a fast, unkeyed hash of a password. */
export function securityRequestFingerprint(payload: unknown) {
  const key = createHmac("sha256", resolveEncryptionKeyBuffer()).update("khidi-security-idempotency-v1").digest();
  return createHmac("sha256", key).update(JSON.stringify(payload)).digest("hex");
}
