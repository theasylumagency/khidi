import { z } from "zod";
import type { MediaStorage } from "./storage.ts";
import { assertObjectKey } from "./storage.ts";
import { resolveMediaFilesystemRoot } from "./storage-config.ts";
export const rawManifestSchema = z.object({ version: z.literal(1), capturedAt: z.string().datetime(), sourceLocation: z.string().min(1), samples: z.array(z.object({
  id: z.string().uuid(), key: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().positive(), versionId: z.string().nullable()
}).strict()).max(10000) }).strict();
export type RawSample = z.infer<typeof rawManifestSchema>["samples"][number];
export async function verifyRawSamples(samples: RawSample[], storage: MediaStorage, options: { sourceVersions?: boolean; databaseSamples?: RawSample[] } = {}) {
  const hashes: { id: string; sha256: string; bytes: number }[] = [];
  for (const sample of samples) {
    assertObjectKey(sample.key, "private");
    if (!sample.key.startsWith(`raw/${sample.id}/`)) throw new Error("Restore sample key/image mismatch.");
    if (options.databaseSamples) {
      const row = options.databaseSamples.find((row) => row.id === sample.id);
      if (!row || row.key !== sample.key || row.sha256 !== sample.sha256 || row.bytes !== sample.bytes) throw new Error(`Restored raw metadata differs: ${sample.id}`);
    }
    // Copies/replicas may assign different storage version IDs. Immutable key+SHA is canonical.
    const bytes = await storage.readPrivate(sample.key, sample.sha256, options.sourceVersions ? sample.versionId ?? undefined : undefined);
    if (bytes.byteLength !== sample.bytes) throw new Error(`Restored raw byte count differs: ${sample.id}`);
    hashes.push({ id: sample.id, sha256: sample.sha256, bytes: sample.bytes });
  }
  return { sampledFiles: hashes.length, hashes };
}
export function mediaLocation(env: NodeJS.ProcessEnv) {
  if ((env.MEDIA_STORAGE_DRIVER ?? (env.NODE_ENV === "production" ? "s3" : "filesystem")) !== "s3") {
    const root = resolveMediaFilesystemRoot(env); return `filesystem:${process.platform === "win32" ? root.toLowerCase() : root}`;
  }
  let endpoint = env.MEDIA_S3_REGION ?? "us-east-1";
  if (env.MEDIA_S3_ENDPOINT) {
    const url = new URL(env.MEDIA_S3_ENDPOINT); if (["localhost", "[::1]"].includes(url.hostname)) url.hostname = "127.0.0.1";
    endpoint = `${url.origin}${url.pathname.replace(/\/$/, "")}`;
  }
  return `s3:${endpoint}:${env.MEDIA_PRIVATE_BUCKET ?? ""}`;
}
export function restoredMediaEnvironment(env: NodeJS.ProcessEnv) {
  const target: NodeJS.ProcessEnv = { NODE_ENV: env.NODE_ENV };
  for (const [key, value] of Object.entries(env)) if (key.startsWith("RESTORE_MEDIA_")) target[key.slice("RESTORE_".length)] = value;
  if (!target.MEDIA_STORAGE_DRIVER) throw new Error("RESTORE_MEDIA_STORAGE_DRIVER is required for a media restore check.");
  return target;
}
