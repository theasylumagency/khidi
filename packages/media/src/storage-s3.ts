import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { assertObjectKey, checkDigest, digest, StorageExistsError, StorageMissingError, type MediaStorage, type StoredObject } from "./storage.ts";

export class S3MediaStorage implements MediaStorage {
  constructor(private readonly client: Pick<S3Client, "send">, readonly privateBucket: string, readonly publicBucket: string) {
    if (!privateBucket || !publicBucket || privateBucket === publicBucket) throw new Error("Separate private and public media buckets are required.");
  }
  async putPrivate(key: string, bytes: Uint8Array, contentType: string): Promise<StoredObject> {
    assertObjectKey(key, "private");
    const sha256 = digest(bytes);
    try {
      const result = await this.client.send(new PutObjectCommand({ Bucket: this.privateBucket, Key: key, Body: bytes,
        ContentType: contentType, IfNoneMatch: "*", Metadata: { sha256 } }));
      return { key, sha256, bytes: bytes.byteLength, contentType, versionId: result.VersionId };
    } catch (error) {
      if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 412) throw new StorageExistsError();
      throw error;
    }
  }
  async readPrivate(key: string, expectedSha256: string, versionId?: string): Promise<Uint8Array> {
    assertObjectKey(key, "private");
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.privateBucket, Key: key, VersionId: versionId }));
      if (!result.Body) throw new StorageMissingError();
      const bytes = await result.Body.transformToByteArray();
      checkDigest(bytes, expectedSha256);
      if (result.Metadata?.sha256) checkDigest(bytes, result.Metadata.sha256);
      return bytes;
    } catch (error) {
      if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) throw new StorageMissingError();
      throw error;
    }
  }
  async putPublic(key: string, bytes: Uint8Array, contentType: string) {
    assertObjectKey(key, "public");
    await this.client.send(new PutObjectCommand({ Bucket: this.publicBucket, Key: key, Body: bytes,
      ContentType: contentType, CacheControl: "public, max-age=300" }));
  }
  async removePublic(key: string) {
    assertObjectKey(key, "public");
    await this.client.send(new DeleteObjectCommand({ Bucket: this.publicBucket, Key: key }));
  }
}
