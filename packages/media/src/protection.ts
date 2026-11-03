import { CreateBucketCommand, GetBucketPolicyCommand, GetBucketReplicationCommand, GetBucketVersioningCommand, GetObjectLockConfigurationCommand, HeadBucketCommand, PutBucketEncryptionCommand, PutBucketPolicyCommand, PutBucketReplicationCommand, PutBucketVersioningCommand, PutObjectLockConfigurationCommand, type ReplicationConfiguration, type S3Client } from "@aws-sdk/client-s3";
export interface MediaProtectionConfig { privateBucket: string; publicBucket: string; retentionDays: number; runtimePrincipal: string; replication?: ReplicationConfiguration; conditionalPolicy: boolean; encryption: boolean }
export interface BucketPolicy { Version: string; Statement: { Sid?: string; [key: string]: unknown }[] }
export function mediaRuntimePolicy(privateBucket: string, publicBucket: string) {
  return { Version: "2012-10-17", Statement: [
    { Sid: "KhidiReadOriginalVersions", Effect: "Allow", Action: ["s3:GetObject", "s3:GetObjectVersion"], Resource: [`arn:aws:s3:::${privateBucket}/*`] },
    { Sid: "KhidiWriteRetainedObjects", Effect: "Allow", Action: "s3:PutObject", Resource: ["raw", "master", "evidence"].map((prefix) => `arn:aws:s3:::${privateBucket}/${prefix}/*`) },
    { Sid: "KhidiManagePublicCopies", Effect: "Allow", Action: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"], Resource: [`arn:aws:s3:::${publicBucket}/*`] }
  ] };
}
export function validateProtectionConfig(config: MediaProtectionConfig) {
  if (!config.privateBucket || !config.publicBucket || config.privateBucket === config.publicBucket || ![config.privateBucket, config.publicBucket].every((bucket) => /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket))) throw new Error("Separate valid media buckets are required.");
  if (!Number.isInteger(config.retentionDays) || config.retentionDays < 30 || config.retentionDays > 36500) throw new Error("Media retention must be at least 30 days.");
  if (!config.runtimePrincipal) throw new Error("A runtime IAM principal or '*' for a bucket-wide retention deny is required.");
  if (config.replication && (!config.replication.Role || !config.replication.Rules?.length || config.replication.Rules.some((rule) => rule.Status !== "Enabled" || !rule.Destination?.Bucket || rule.Destination.Bucket === `arn:aws:s3:::${config.privateBucket}`))) throw new Error("Replication requires an enabled rule, role and separate destination.");
}
export function protectedBucketPolicy(config: MediaProtectionConfig, existing?: BucketPolicy): BucketPolicy {
  validateProtectionConfig(config);
  const resources = ["raw", "master", "evidence"].map((prefix) => `arn:aws:s3:::${config.privateBucket}/${prefix}/*`);
  return { Version: "2012-10-17", Statement: [
    ...(existing?.Statement ?? []).filter((statement) => !statement.Sid?.startsWith("KhidiRetained")),
    { Sid: "KhidiRetainedNoDelete", Effect: "Deny", Principal: { AWS: config.runtimePrincipal }, Action: ["s3:DeleteObject", "s3:DeleteObjectVersion", "s3:BypassGovernanceRetention"], Resource: resources },
    ...(config.conditionalPolicy ? [
      { Sid: "KhidiRetainedRequireConditionalWrite", Effect: "Deny", Principal: { AWS: config.runtimePrincipal }, Action: "s3:PutObject", Resource: resources, Condition: { Null: { "s3:if-none-match": "true" } } },
      { Sid: "KhidiRetainedRequireNewKey", Effect: "Deny", Principal: { AWS: config.runtimePrincipal }, Action: "s3:PutObject", Resource: resources, Condition: { StringNotEquals: { "s3:if-none-match": "*" } } }
    ] : [])
  ] };
}
function missing(error: unknown) { return ["NotFound", "NoSuchBucket", "NoSuchBucketPolicy"].includes((error as Error).name) || (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404; }
export async function configureMediaProtection(client: Pick<S3Client, "send">, config: MediaProtectionConfig, createMissing = false) {
  validateProtectionConfig(config);
  for (const bucket of [config.privateBucket, config.publicBucket]) {
    try { await client.send(new HeadBucketCommand({ Bucket: bucket })); }
    catch (error) { if (!createMissing || !missing(error)) throw error; await client.send(new CreateBucketCommand({ Bucket: bucket, ...(bucket === config.privateBucket ? { ObjectLockEnabledForBucket: true } : {}) })); }
    await client.send(new PutBucketVersioningCommand({ Bucket: bucket, VersioningConfiguration: { Status: "Enabled" } }));
    if (config.encryption) await client.send(new PutBucketEncryptionCommand({ Bucket: bucket, ServerSideEncryptionConfiguration: { Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } }] } }));
  }
  await client.send(new PutObjectLockConfigurationCommand({ Bucket: config.privateBucket, ObjectLockConfiguration: { ObjectLockEnabled: "Enabled", Rule: { DefaultRetention: { Mode: "COMPLIANCE", Days: config.retentionDays } } } }));
  let existing: BucketPolicy | undefined;
  try { const policy = await client.send(new GetBucketPolicyCommand({ Bucket: config.privateBucket })); if (policy.Policy) existing = JSON.parse(policy.Policy); }
  catch (error) { if (!missing(error)) throw error; }
  await client.send(new PutBucketPolicyCommand({ Bucket: config.privateBucket, Policy: JSON.stringify(protectedBucketPolicy(config, existing)) }));
  if (config.replication) await client.send(new PutBucketReplicationCommand({ Bucket: config.privateBucket, ReplicationConfiguration: config.replication }));
  const [privateVersioning, publicVersioning, lock] = await Promise.all([
    client.send(new GetBucketVersioningCommand({ Bucket: config.privateBucket })), client.send(new GetBucketVersioningCommand({ Bucket: config.publicBucket })), client.send(new GetObjectLockConfigurationCommand({ Bucket: config.privateBucket }))
  ]);
  if (privateVersioning.Status !== "Enabled" || publicVersioning.Status !== "Enabled" || lock.ObjectLockConfiguration?.Rule?.DefaultRetention?.Mode !== "COMPLIANCE" || (lock.ObjectLockConfiguration.Rule.DefaultRetention.Days ?? 0) < 30) throw new Error("Media protection verification failed.");
  if (config.replication) {
    const actual = (await client.send(new GetBucketReplicationCommand({ Bucket: config.privateBucket }))).ReplicationConfiguration;
    if (!actual || actual.Role !== config.replication.Role || config.replication.Rules!.some((rule) => !actual.Rules?.some((saved) => saved.ID === rule.ID && saved.Status === "Enabled" && saved.Destination?.Bucket === rule.Destination?.Bucket))) throw new Error("Media replication configuration verification failed.");
  }
  return { versioning: true, retentionDays: lock.ObjectLockConfiguration.Rule.DefaultRetention.Days, replicationConfigured: !!config.replication };
}
