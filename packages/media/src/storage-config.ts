import path from "node:path";
import { existsSync } from "node:fs";
import { S3Client } from "@aws-sdk/client-s3";
import { FilesystemMediaStorage, type MediaStorage } from "./storage.ts";
import { S3MediaStorage } from "./storage-s3.ts";

export function createMediaStorage(env: NodeJS.ProcessEnv = process.env): MediaStorage {
  const driver = env.MEDIA_STORAGE_DRIVER ?? (env.NODE_ENV === "production" ? "s3" : "filesystem");
  if (driver === "filesystem") {
    if (env.NODE_ENV === "production") throw new Error("Production media requires protected S3-compatible storage.");
    return new FilesystemMediaStorage(resolveMediaFilesystemRoot(env));
  }
  if (driver !== "s3") throw new Error("Unknown media storage driver.");
  const privateBucket = env.MEDIA_PRIVATE_BUCKET, publicBucket = env.MEDIA_PUBLIC_BUCKET;
  if (!privateBucket || !publicBucket || privateBucket === publicBucket) throw new Error("Separate private/public media buckets must be configured.");
  if (env.MEDIA_S3_ENDPOINT) {
    const url = new URL(env.MEDIA_S3_ENDPOINT);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password
      || env.NODE_ENV === "production" && url.protocol !== "https:") throw new Error("Invalid media storage endpoint; production requires HTTPS.");
  }
  return new S3MediaStorage(createMediaS3Client(env), privateBucket, publicBucket);
}
export function resolveMediaFilesystemRoot(env: NodeJS.ProcessEnv = process.env) {
  const configured = env.MEDIA_FILESYSTEM_ROOT;
  if (configured && path.isAbsolute(configured)) return path.resolve(configured);
  let root = process.cwd();
  while (!existsSync(path.join(root, "pnpm-workspace.yaml"))) {
    const parent = path.dirname(root);
    if (parent === root) throw new Error("Configure an absolute MEDIA_FILESYSTEM_ROOT outside the development workspace.");
    root = parent;
  }
  return path.resolve(root, configured ?? ".local-media");
}
export function createMediaS3Client(env: NodeJS.ProcessEnv = process.env) {
  if (env.MEDIA_S3_ENDPOINT) {
    const endpoint = new URL(env.MEDIA_S3_ENDPOINT);
    if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password || env.NODE_ENV === "production" && endpoint.protocol !== "https:") throw new Error("Invalid media endpoint; production requires HTTPS.");
  }
  const accessKeyId = env.MEDIA_S3_ACCESS_KEY_ID, secretAccessKey = env.MEDIA_S3_SECRET_ACCESS_KEY;
  if (!!accessKeyId !== !!secretAccessKey) throw new Error("Both media storage credentials must be configured together.");
  if (env.NODE_ENV === "production" && (["khidi-dev", "khidi-runtime"].includes(accessKeyId ?? "") || ["khidi_minio_dev_password", "khidi_runtime_dev_password"].includes(secretAccessKey ?? ""))) throw new Error("Development media credentials are forbidden in production.");
  return new S3Client({ region: env.MEDIA_S3_REGION ?? "us-east-1", endpoint: env.MEDIA_S3_ENDPOINT,
    forcePathStyle: env.MEDIA_S3_FORCE_PATH_STYLE === "true", credentials: accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined });
}
let instance: MediaStorage | undefined;
export function getMediaStorage() { return instance ??= createMediaStorage(); }
