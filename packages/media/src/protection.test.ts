import { describe, expect, it, vi } from "vitest";
import type { S3Client } from "@aws-sdk/client-s3";
import { configureMediaProtection, mediaRuntimePolicy, protectedBucketPolicy, type MediaProtectionConfig } from "./protection.ts";
import { readMediaProtectionConfig } from "../../../ops/media-storage.ts";
const config: MediaProtectionConfig = { privateBucket: "khidi-private", publicBucket: "khidi-public", runtimePrincipal: "arn:aws:iam::123456789012:role/khidi-runtime", retentionDays: 30, conditionalPolicy: true, encryption: true,
  replication: { Role: "arn:aws:iam::123456789012:role/khidi-replication", Rules: [{ ID: "KhidiPrivateReplica", Status: "Enabled", Priority: 1, Filter: { Prefix: "" }, DeleteMarkerReplication: { Status: "Disabled" }, Destination: { Bucket: "arn:aws:s3:::khidi-private-replica" } }] } };
describe("P10 storage protection plans", () => {
  it("merges only its policy statements, denies retained-object deletion and requires new-key writes", () => {
    const policy = protectedBucketPolicy(config, { Version: "2012-10-17", Statement: [{ Sid: "ExistingOperatorPolicy", Effect: "Allow" }, { Sid: "KhidiRetainedOldRule" }] });
    expect(policy.Statement[0]!.Sid).toBe("ExistingOperatorPolicy"); expect(policy.Statement.some((s) => s.Sid === "KhidiRetainedOldRule")).toBe(false);
    expect(JSON.stringify(policy)).toContain("s3:if-none-match"); expect(JSON.stringify(policy)).toContain("s3:DeleteObjectVersion");
    const runtime = mediaRuntimePolicy(config.privateBucket, config.publicBucket); expect(runtime.Statement.find((s) => s.Sid === "KhidiWriteRetainedObjects")!.Action).toBe("s3:PutObject"); expect(JSON.stringify(runtime)).not.toContain("s3:PutBucketPolicy");
  });
  it("enables both bucket versions, retention, encryption and replication and checks the result", async () => {
    const send = vi.fn(async (command) => {
      const name = command.constructor.name;
      if (name === "GetBucketPolicyCommand") return { Policy: JSON.stringify({ Version: "2012-10-17", Statement: [] }) };
      if (name === "GetBucketVersioningCommand") return { Status: "Enabled" };
      if (name === "GetBucketReplicationCommand") return { ReplicationConfiguration: config.replication };
      if (name === "GetObjectLockConfigurationCommand") return { ObjectLockConfiguration: { Rule: { DefaultRetention: { Mode: "COMPLIANCE", Days: 30 } } } };
      return {};
    });
    expect(await configureMediaProtection({ send } as unknown as S3Client, config)).toMatchObject({ versioning: true, retentionDays: 30, replicationConfigured: true });
    expect(send.mock.calls.filter(([command]) => command.constructor.name === "PutBucketVersioningCommand")).toHaveLength(2);
    expect(send.mock.calls.find(([command]) => command.constructor.name === "PutBucketReplicationCommand")![0].input.ReplicationConfiguration).toEqual(config.replication);
  });
  it("fails before changes for incomplete or weakened production protection", () => {
    expect(() => protectedBucketPolicy({ ...config, retentionDays: 29 })).toThrow(); expect(() => protectedBucketPolicy({ ...config, publicBucket: config.privateBucket })).toThrow();
    expect(() => readMediaProtectionConfig({ NODE_ENV: "production", MEDIA_PRIVATE_BUCKET: config.privateBucket, MEDIA_PUBLIC_BUCKET: config.publicBucket, MEDIA_RUNTIME_PRINCIPAL: config.runtimePrincipal })).toThrow(/replication/);
  });
});
