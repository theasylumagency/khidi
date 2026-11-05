// Synthetic authenticator construction for tests only. Production verification uses SimpleWebAuthn.
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from "@simplewebauthn/server";
export function authenticator() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = publicKey.export({ format: "jwk" }), idBytes = randomBytes(32), id = idBytes.toString("base64url");
  const cose = isoCBOR.encode(new Map<number, number | Uint8Array>([[1, 2], [3, -7], [-1, 1],
    [-2, new Uint8Array(Buffer.from(jwk.x!, "base64url"))], [-3, new Uint8Array(Buffer.from(jwk.y!, "base64url"))]]));
  const authData = (register: boolean, counter: number, uv: boolean, rpID: string) => {
    const count = Buffer.alloc(4); count.writeUInt32BE(counter);
    const prefix = Buffer.concat([createHash("sha256").update(rpID).digest(), Buffer.from([(register ? 0x40 : 0) | 1 | (uv ? 4 : 0)]), count]);
    const length = Buffer.alloc(2); length.writeUInt16BE(idBytes.length);
    return register ? Buffer.concat([prefix, Buffer.alloc(16), length, idBytes, cose]) : prefix;
  };
  return {
    id,
    registration(challenge: string, options: { uv?: boolean; origin?: string; rpID?: string } = {}): RegistrationResponseJSON {
      const clientDataJSON = Buffer.from(JSON.stringify({ type: "webauthn.create", challenge, origin: options.origin ?? "http://localhost:3100", crossOrigin: false })).toString("base64url");
      const attestation = isoCBOR.encode(new Map<string, unknown>([["fmt", "none"], ["attStmt", new Map()],
        ["authData", new Uint8Array(authData(true, 0, options.uv ?? true, options.rpID ?? "localhost"))]]) as Parameters<typeof isoCBOR.encode>[0]);
      return { id, rawId: id, type: "public-key", clientExtensionResults: {}, authenticatorAttachment: "platform",
        response: { clientDataJSON, attestationObject: Buffer.from(attestation).toString("base64url"), transports: ["internal"] } };
    },
    assertion(challenge: string, userId: string, counter = 1, options: { uv?: boolean; origin?: string; rpID?: string } = {}): AuthenticationResponseJSON {
      const client = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge, origin: options.origin ?? "http://localhost:3100", crossOrigin: false }));
      const data = authData(false, counter, options.uv ?? true, options.rpID ?? "localhost");
      const signature = sign("sha256", Buffer.concat([data, createHash("sha256").update(client).digest()]), privateKey);
      return { id, rawId: id, type: "public-key", clientExtensionResults: {}, authenticatorAttachment: "platform",
        response: { clientDataJSON: client.toString("base64url"), authenticatorData: data.toString("base64url"), signature: signature.toString("base64url"), userHandle: Buffer.from(userId).toString("base64url") } };
    }
  };
}
