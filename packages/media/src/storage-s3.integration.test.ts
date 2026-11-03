import { expect, it } from "vitest";
import { GetObjectCommand, DeleteObjectCommand, GetBucketVersioningCommand, GetObjectLockConfigurationCommand } from "@aws-sdk/client-s3";
import { createUuidV7 } from "@khidi/shared";
import { createMediaS3Client } from "./storage-config.ts";
import { S3MediaStorage } from "./storage-s3.ts";
import { digest, StorageExistsError, StorageIntegrityError } from "./storage.ts";
const endpoint = process.env.MEDIA_TEST_S3_ENDPOINT;
it.skipIf(!endpoint)("P10 real MinIO: versioned immutable raw bytes, SHA reads, deletion protection and removable public copies", async () => {
  if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(endpoint!).hostname)) throw new Error("SAFETY: S3 integration tests require a local MinIO endpoint.");
  const client = createMediaS3Client({ NODE_ENV: "test", MEDIA_S3_ENDPOINT: endpoint, MEDIA_S3_REGION: "us-east-1", MEDIA_S3_FORCE_PATH_STYLE: "true", MEDIA_S3_ACCESS_KEY_ID: process.env.MEDIA_TEST_S3_ACCESS_KEY_ID ?? "khidi-runtime", MEDIA_S3_SECRET_ACCESS_KEY: process.env.MEDIA_TEST_S3_SECRET_ACCESS_KEY ?? "khidi_runtime_dev_password" });
  const privateBucket = process.env.MEDIA_TEST_PRIVATE_BUCKET ?? "khidi-test-private", publicBucket = process.env.MEDIA_TEST_PUBLIC_BUCKET ?? "khidi-test-public";
  if (![privateBucket, publicBucket].every((bucket) => bucket.startsWith("khidi-test-"))) throw new Error("SAFETY: use dedicated khidi-test- media buckets.");
  const admin = createMediaS3Client({ NODE_ENV: "test", MEDIA_S3_ENDPOINT: endpoint, MEDIA_S3_REGION: "us-east-1", MEDIA_S3_FORCE_PATH_STYLE: "true", MEDIA_S3_ACCESS_KEY_ID: process.env.MEDIA_TEST_ADMIN_ACCESS_KEY_ID ?? "khidi-dev", MEDIA_S3_SECRET_ACCESS_KEY: process.env.MEDIA_TEST_ADMIN_SECRET_ACCESS_KEY ?? "khidi_minio_dev_password" });
  try {
    expect((await admin.send(new GetBucketVersioningCommand({ Bucket: privateBucket }))).Status).toBe("Enabled");
    expect((await admin.send(new GetBucketVersioningCommand({ Bucket: publicBucket }))).Status).toBe("Enabled");
    expect((await admin.send(new GetObjectLockConfigurationCommand({ Bucket: privateBucket }))).ObjectLockConfiguration?.Rule?.DefaultRetention).toMatchObject({ Mode: "COMPLIANCE", Days: 30 });
    const storage = new S3MediaStorage(client, privateBucket, publicBucket), id = createUuidV7(), key = `raw/${id}/original.jpg`, bytes = new Uint8Array([255, 216, 1, 2, 3, 255, 217]);
    const stored = await storage.putPrivate(key, bytes, "image/jpeg"); expect(stored.versionId).toBeTruthy();
    expect(await storage.readPrivate(key, digest(bytes), stored.versionId)).toEqual(bytes);
    const original = await client.send(new GetObjectCommand({ Bucket: privateBucket, Key: key, VersionId: stored.versionId })); expect(await original.Body!.transformToByteArray()).toEqual(bytes);
    await expect(storage.putPrivate(key, bytes, "image/jpeg")).rejects.toBeInstanceOf(StorageExistsError);
    await expect(storage.readPrivate(key, "f".repeat(64))).rejects.toBeInstanceOf(StorageIntegrityError);
    await expect(client.send(new DeleteObjectCommand({ Bucket: privateBucket, Key: key, VersionId: stored.versionId }))).rejects.toBeDefined();
    await expect(client.send(new DeleteObjectCommand({ Bucket: privateBucket, Key: key }))).rejects.toBeDefined();
    const publicKey = "neutral-tool-1-400.webp"; await storage.putPublic(publicKey, bytes, "image/webp"); await storage.removePublic(publicKey);
    await expect(client.send(new GetObjectCommand({ Bucket: publicBucket, Key: publicKey }))).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });
    expect(await storage.readPrivate(key, digest(bytes), stored.versionId)).toEqual(bytes);
  } finally { client.destroy(); admin.destroy(); }
}, 60000);
