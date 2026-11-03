import { spawn } from "node:child_process";
import { mkdtemp, rmdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createMediaS3Client } from "../packages/media/src/storage-config.ts";
import { configureMediaProtection, mediaRuntimePolicy } from "../packages/media/src/protection.ts";
async function docker(args: string[], capture = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { shell: false, stdio: ["ignore", "pipe", "pipe"] }); let output = "";
    child.stdout.on("data", (chunk: Buffer) => { if (capture) output += chunk.toString(); });
    child.stderr.on("data", () => {}); child.on("error", reject); child.on("exit", (code) => code === 0 ? resolve(output.trim()) : reject(new Error("Development MinIO provisioning failed; inspect the local container.")));
  });
}
export async function initializeDevMinio(env: NodeJS.ProcessEnv = process.env) {
  if (env.NODE_ENV === "production") throw new Error("SAFETY: the MinIO initializer is for local development only.");
  const endpoint = new URL(env.MEDIA_S3_ENDPOINT ?? "http://127.0.0.1:9000"), container = env.MINIO_DEV_CONTAINER ?? "khidi-minio-dev";
  if (!["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname) || !/^khidi-(minio-dev|m4-minio-test)$/.test(container)) throw new Error("SAFETY: use the named local MinIO development container only.");
  if (!(await docker(["inspect", "--format", "{{.Config.Image}}", container], true)).startsWith("khidi-minio-dev:")) throw new Error("SAFETY: unexpected MinIO container image.");
  const privateBucket = env.MEDIA_PRIVATE_BUCKET ?? "khidi-private", publicBucket = env.MEDIA_PUBLIC_BUCKET ?? "khidi-public";
  const rootUser = env.MINIO_DEV_ROOT_USER ?? "khidi-dev", rootPassword = env.MINIO_DEV_ROOT_PASSWORD ?? "khidi_minio_dev_password";
  const accessKey = env.MEDIA_S3_ACCESS_KEY_ID ?? "khidi-runtime", secretKey = env.MEDIA_S3_SECRET_ACCESS_KEY ?? "khidi_runtime_dev_password";
  if (accessKey === rootUser) throw new Error("SAFETY: development runtime and root accounts must differ.");
  const client = createMediaS3Client({ ...env, NODE_ENV: "development", MEDIA_S3_ENDPOINT: endpoint.toString(), MEDIA_S3_FORCE_PATH_STYLE: "true", MEDIA_S3_ACCESS_KEY_ID: rootUser, MEDIA_S3_SECRET_ACCESS_KEY: rootPassword });
  try { await configureMediaProtection(client, { privateBucket, publicBucket, runtimePrincipal: "*", retentionDays: 30, conditionalPolicy: false, encryption: false }, true); }
  finally { client.destroy(); }
  const directory = await mkdtemp(path.join(tmpdir(), "khidi-minio-policy-")), filename = path.join(directory, "runtime.json"), remote = "/tmp/khidi-runtime-policy.json";
  try {
    await writeFile(filename, JSON.stringify(mediaRuntimePolicy(privateBucket, publicBucket)), { mode: 0o600 });
    await docker(["cp", filename, `${container}:${remote}`]);
    const mc = ["exec", container, "mc", "--config-dir", "/tmp/khidi-mc"];
    await docker([...mc, "alias", "set", "local", "http://127.0.0.1:9000", rootUser, rootPassword]);
    await docker([...mc, "admin", "user", "add", "local", accessKey, secretKey]);
    await docker([...mc, "admin", "policy", "create", "local", "khidi-runtime", remote]);
    await docker([...mc, "admin", "policy", "attach", "local", "khidi-runtime", "--user", accessKey]);
  } finally { await unlink(filename); await rmdir(directory); }
  return { privateBucket, publicBucket, versioning: true, runtimeAccount: accessKey };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await initializeDevMinio()));
