import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { assertIsolatedRestoreUrls, captureRestoreSnapshot, checkRestoredMigrations, compareRestoreSnapshots } from "../packages/db/src/restore-verification.ts";
import { latestFullBackup, OpsRunner, readOpsConfig, required } from "./common.ts";
import { takeBackup } from "./backup.ts";
import { restoreBackup } from "./restore.ts";

export async function verifyRestore(env: NodeJS.ProcessEnv = process.env) {
  if (env.SOURCE_WRITERS_STOPPED !== "yes") throw new Error("Stop Hub, workers and all other source writers; then set SOURCE_WRITERS_STOPPED=yes.");
  const sourceUrl = required("SOURCE_MIGRATOR_URL", env), restoredMigrator = required("RESTORE_MIGRATOR_URL", env), restoredApp = required("RESTORE_APP_URL", env);
  assertIsolatedRestoreUrls(sourceUrl, restoredMigrator, restoredApp);
  const runner = new OpsRunner(readOpsConfig(env));
  if (!runner.config.container && Number(new URL(restoredMigrator).port || 5432) !== runner.config.restorePort) throw new Error("Restore URL port differs from RESTORE_PORT.");
  await runner.assertCleanRestoreDirectory();
  const reportPath = required("RESTORE_REPORT", env);
  // Reserve a new report, never overwrite an earlier restore record.
  const report = { startedAt: new Date().toISOString(), backupSet: "", checksumsMatch: false, countsMatch: false, testsPassed: false };
  await writeFile(reportPath, JSON.stringify(report, null, 2), { flag: "wx", mode: 0o600 });
  let started = false;
  try {
    const source = await captureRestoreSnapshot(sourceUrl);
    checkRestoredMigrations(source);
    await takeBackup(runner);
    report.backupSet = latestFullBackup(JSON.parse(await runner.pgbackrest(["--output=json", "info"], true)), runner.config.stanza);
    await restoreBackup(runner, report.backupSet);
    // The restored instance starts on its dedicated port; source stays online.
    await runner.command("pg_ctl", ["-D", runner.config.restorePath, "-l", `${runner.config.restorePath}/verification.log`,
      "-o", `-p ${runner.config.restorePort} -h '${runner.config.container ? "*" : "127.0.0.1"}' -k /tmp -c archive_mode=off`, "-w", "start"]);
    started = true;
    const restored = await captureRestoreSnapshot(restoredMigrator);
    checkRestoredMigrations(restored); report.checksumsMatch = true;
    compareRestoreSnapshots(source, restored); report.countsMatch = true;
    // Compare before tests: migrations/seed/test fixtures intentionally mutate the copy.
    await runner.command("corepack", ["pnpm", "test"], { local: true, env: { ...env, NODE_ENV: "test", DATABASE_URL: restoredApp, DATABASE_MIGRATOR_URL: restoredMigrator } });
    report.testsPassed = true;
    await writeFile(reportPath, JSON.stringify({ ...report, finishedAt: new Date().toISOString(), source, restored }, null, 2));
  } finally {
    if (!report.testsPassed) await writeFile(reportPath, JSON.stringify({ ...report, finishedAt: new Date().toISOString() }, null, 2));
    if (started) await runner.command("pg_ctl", ["-D", runner.config.restorePath, "-m", "fast", "-w", "stop"]);
  }
  console.log(`Restore verified; report: ${reportPath}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyRestore().catch((error: Error) => { console.error(error.message); process.exitCode = 1; });
}
