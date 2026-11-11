import { fileURLToPath } from "node:url";
import path from "node:path";
import { OpsRunner, readOpsConfig, required } from "./common.ts";

export async function restoreBackup(runner: OpsRunner, backupSet: string, targetTime?: string) {
  if (!/^\d{8}-\d{6}F$/.test(backupSet)) throw new Error("An explicit full backup set is required.");
  if (targetTime && (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(targetTime) || !Number.isFinite(Date.parse(targetTime)))) throw new Error("Recovery target must be an ISO timestamp with timezone.");
  await runner.assertCleanRestoreDirectory();
  await runner.pgbackrest([`--pg1-path=${runner.config.restorePath}`, `--set=${backupSet}`, "--archive-mode=off",
    "--target-action=promote", ...(targetTime ? ["--type=time", `--target=${targetTime}`] : ["--type=immediate"]), "restore"]);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  restoreBackup(new OpsRunner(readOpsConfig()), required("BACKUP_SET"), process.env.RECOVERY_TARGET_TIME)
    .catch((error: Error) => { console.error("Khidi operation failed; inspect configuration and service health."); process.exitCode = 1; });
}
