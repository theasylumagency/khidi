import { fileURLToPath } from "node:url";
import path from "node:path";
import { createMediaS3Client } from "../packages/media/src/storage-config.ts";
import { configureMediaProtection, mediaRuntimePolicy, protectedBucketPolicy, validateProtectionConfig, type MediaProtectionConfig } from "../packages/media/src/protection.ts";
import { required } from "./common.ts";
export function readMediaProtectionConfig(env: NodeJS.ProcessEnv = process.env): MediaProtectionConfig {
  const config: MediaProtectionConfig = { privateBucket: required("MEDIA_PRIVATE_BUCKET", env), publicBucket: required("MEDIA_PUBLIC_BUCKET", env), runtimePrincipal: required("MEDIA_RUNTIME_PRINCIPAL", env), retentionDays: Number(env.MEDIA_RETENTION_DAYS ?? 30),
    replication: env.MEDIA_REPLICATION_CONFIG_JSON ? JSON.parse(env.MEDIA_REPLICATION_CONFIG_JSON) : undefined, conditionalPolicy: env.MEDIA_CONDITIONAL_POLICY !== "false", encryption: env.MEDIA_BUCKET_ENCRYPTION !== "false" };
  validateProtectionConfig(config);
  if (env.NODE_ENV === "production" && (!config.replication || !config.conditionalPolicy || !config.encryption)) throw new Error("Production storage requires replication, conditional writes and encryption.");
  if (env.NODE_ENV === "production" && (!env.MEDIA_REPLICA_LOCATION || env.MEDIA_REPLICA_LOCATION === (env.MEDIA_S3_ENDPOINT ?? env.MEDIA_S3_REGION ?? "us-east-1"))) throw new Error("Declare a distinct MEDIA_REPLICA_LOCATION after provisioning the destination.");
  return config;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = readMediaProtectionConfig();
  if (process.env.NODE_ENV === "production" && process.argv.includes("--create")) throw new Error("Provision production buckets in their intended region through infrastructure before applying protection.");
  if (!process.argv.includes("--apply")) console.log(JSON.stringify({ mode: "PLAN", config, privatePolicy: protectedBucketPolicy(config), runtimePolicy: mediaRuntimePolicy(config.privateBucket, config.publicBucket) }, null, 2));
  else { const client = createMediaS3Client(); try { console.log(JSON.stringify(await configureMediaProtection(client, config, process.argv.includes("--create")))); } finally { client.destroy(); } }
}
