import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createUuidV7 } from "@khidi/shared";
import { FilesystemMediaStorage, digest, privateImageKey, StorageExistsError, StorageIntegrityError } from "./storage.ts";
import { S3MediaStorage } from "./storage-s3.ts";
import { createMediaStorage } from "./storage-config.ts";
import type { S3Client } from "@aws-sdk/client-s3";

describe("P1 immutable private media storage", () => {
  it("reads a recovered immutable key when the replica has a different version ID, still requiring its original hash",async()=>{
    const bytes=new Uint8Array([1,2,3]),key=privateImageKey(createUuidV7(),"original.jpg"),missing={$metadata:{httpStatusCode:404}};
    const send=vi.fn().mockRejectedValueOnce(missing).mockResolvedValueOnce({Body:{transformToByteArray:async()=>bytes}});
    const storage=new S3MediaStorage({send} as unknown as S3Client,"private","public");
    expect(await storage.readPrivate(key,digest(bytes),"old-site-version")).toEqual(bytes);
    expect(send.mock.calls[1]![0].input.VersionId).toBeUndefined();
    send.mockRejectedValueOnce(missing).mockResolvedValueOnce({Body:{transformToByteArray:async()=>new Uint8Array([9])}});
    await expect(storage.readPrivate(key,digest(bytes),"old-site-version")).rejects.toBeInstanceOf(StorageIntegrityError);
    send.mockRejectedValueOnce({$metadata:{httpStatusCode:403}});
    const count=send.mock.calls.length;await expect(storage.readPrivate(key,digest(bytes),"old-site-version")).rejects.toBeDefined();expect(send.mock.calls.length).toBe(count+1);
  });
  const roots: string[] = [];
  afterEach(async () => {
    for (const root of roots.splice(0)) {
      if (path.dirname(path.resolve(root)) !== path.resolve(tmpdir()) || !path.basename(root).startsWith("khidi-media-test-")) throw new Error("Unsafe test cleanup path.");
      await rm(root, { recursive: true, force: true });
    }
  });
  async function local() { const root = await mkdtemp(path.join(tmpdir(), "khidi-media-test-")); roots.push(root); return new FilesystemMediaStorage(root); }
  it("stores exact bytes, atomically refuses concurrent overwrites and verifies SHA on every read", async () => {
    const storage = await local(), key = privateImageKey(createUuidV7(), "original.jpg");
    const bytes = new Uint8Array([255, 216, 0, 1, 2, 255, 217]);
    const results = await Promise.allSettled([storage.putPrivate(key, bytes, "image/jpeg"), storage.putPrivate(key, bytes, "image/jpeg")]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({ reason: expect.any(StorageExistsError) });
    expect(await storage.readPrivate(key, digest(bytes))).toEqual(Buffer.from(bytes));
    expect(await readFile(path.join(storage.root, "private", key))).toEqual(Buffer.from(bytes));
    await writeFile(path.join(storage.root, "private", key), new Uint8Array([0])); // Simulate corruption outside the adapter.
    await expect(storage.readPrivate(key, digest(bytes))).rejects.toBeInstanceOf(StorageIntegrityError);
  });
  it("keeps evidence and earlier master versions write-once and exposes deletion only for public copies", async () => {
    const storage = await local(), id = createUuidV7(), bytes = new Uint8Array([1, 2]);
    for (const key of [`evidence/${id}/document.bin`, `master/${id}/v1/master.jpg`, `master/${id}/v2/master.jpg`]) {
      await storage.putPrivate(key, bytes, "application/octet-stream");
      await expect(storage.putPrivate(key, bytes, "application/octet-stream")).rejects.toBeInstanceOf(StorageExistsError);
    }
    await storage.putPublic("catalog-product-1-400.webp", bytes, "image/webp");
    await storage.removePublic("catalog-product-1-400.webp");
    await expect(readFile(path.join(storage.root, "public", "catalog-product-1-400.webp"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(storage).not.toHaveProperty("removePrivate");
  });
  it("rejects traversal, cross-area paths and internal SKU-based private keys", async () => {
    const storage = await local();
    for (const key of ["../raw/a", "raw/../../a", "raw/KH-000001/original.jpg", "public/raw.jpg", "raw\\bad"]) {
      await expect(storage.putPrivate(key, new Uint8Array([1]), "image/jpeg")).rejects.toThrow();
    }
  });
  it("uses conditional S3 writes, separate buckets, pinned versions and verified reads", async () => {
    const bytes = new Uint8Array([1, 2, 3]), sha = digest(bytes), key = privateImageKey(createUuidV7(), "original.png");
    const send = vi.fn().mockResolvedValueOnce({ VersionId: "version-1" }).mockResolvedValueOnce({ Body: { transformToByteArray: async () => bytes }, Metadata: { sha256: sha } });
    const storage = new S3MediaStorage({ send } as unknown as S3Client, "khidi-private", "khidi-public");
    expect(await storage.putPrivate(key, bytes, "image/png")).toMatchObject({ sha256: sha, versionId: "version-1" });
    expect(send.mock.calls[0]![0].input).toMatchObject({ Bucket: "khidi-private", IfNoneMatch: "*", Metadata: { sha256: sha } });
    expect(await storage.readPrivate(key, sha, "version-1")).toEqual(bytes);
    expect(send.mock.calls[1]![0].input.VersionId).toBe("version-1");
    send.mockRejectedValueOnce({ $metadata: { httpStatusCode: 412 } });
    await expect(storage.putPrivate(key, bytes, "image/png")).rejects.toBeInstanceOf(StorageExistsError);
    send.mockResolvedValueOnce({ Body: { transformToByteArray: async () => new Uint8Array([9]) } });
    await expect(storage.readPrivate(key, sha)).rejects.toBeInstanceOf(StorageIntegrityError);
  });
  it("fails closed for production filesystem/default credentials and shared buckets", () => {
    expect(() => createMediaStorage({ NODE_ENV: "production", MEDIA_STORAGE_DRIVER: "filesystem" })).toThrow(/Production/);
    expect(() => createMediaStorage({ NODE_ENV: "production", MEDIA_PRIVATE_BUCKET: "same", MEDIA_PUBLIC_BUCKET: "same" })).toThrow(/Separate/);
    expect(() => createMediaStorage({ NODE_ENV: "production", MEDIA_PRIVATE_BUCKET: "a", MEDIA_PUBLIC_BUCKET: "b", MEDIA_S3_ENDPOINT: "http://example.org" })).toThrow(/HTTPS/);
    expect(() => createMediaStorage({ NODE_ENV: "production", MEDIA_PRIVATE_BUCKET: "a", MEDIA_PUBLIC_BUCKET: "b", MEDIA_S3_ACCESS_KEY_ID: "khidi-dev", MEDIA_S3_SECRET_ACCESS_KEY: "khidi_minio_dev_password" })).toThrow(/Development/);
  });
});
