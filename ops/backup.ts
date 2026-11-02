import { fileURLToPath } from "node:url";
import path from "node:path";
import { OpsRunner, readOpsConfig } from "./common.ts";

export async function takeBackup(runner = new OpsRunner(readOpsConfig())) {
  await runner.pgbackrest(["--type=full", "backup"]);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  takeBackup().catch((error: Error) => { console.error(error.message); process.exitCode = 1; });
}
