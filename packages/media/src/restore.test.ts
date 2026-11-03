import { expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createUuidV7 } from "@khidi/shared";
import { FilesystemMediaStorage, digest } from "./storage.ts";
import { rawManifestSchema, restoredMediaEnvironment, verifyRawSamples } from "./restore.ts";
it("P10 verifies restored raw hashes, byte counts and DB metadata from a separate recovered storage copy", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "khidi-media-restore-test-"));
  try {
    const source = new FilesystemMediaStorage(path.join(root, "source")), restored = new FilesystemMediaStorage(path.join(root, "restored"));
    const id = createUuidV7(), key = `raw/${id}/original.jpg`, bytes = new Uint8Array([1, 2, 3]); await source.putPrivate(key, bytes, "image/jpeg");
    const sample = { id, key, sha256: digest(bytes), bytes: bytes.length, versionId: null };
    const manifest = rawManifestSchema.parse({ version: 1, sourceLocation: "filesystem:source", capturedAt: new Date().toISOString(), samples: [sample] });
    await restored.putPrivate(key, await source.readPrivate(key, sample.sha256), "image/jpeg");
    expect(await verifyRawSamples(manifest.samples, restored, { databaseSamples: [sample] })).toMatchObject({ sampledFiles: 1 });
    await expect(verifyRawSamples(manifest.samples, restored, { databaseSamples: [{ ...sample, sha256: "f".repeat(64) }] })).rejects.toThrow(/metadata differs/);
    await writeFile(path.join(root, "restored", "private", key), new Uint8Array([9]));
    await expect(verifyRawSamples(manifest.samples, restored)).rejects.toThrow(/SHA-256/);
    expect(() => restoredMediaEnvironment({})).toThrow(/RESTORE_MEDIA_STORAGE_DRIVER/);
  } finally {
    if (path.dirname(path.resolve(root)) !== path.resolve(tmpdir()) || !path.basename(root).startsWith("khidi-media-restore-test-")) throw new Error("Unsafe cleanup."); await rm(root, { recursive: true, force: true });
  }
});
