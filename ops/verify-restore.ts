import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { assertIsolatedRestoreUrls, assertRestoreTestCopyUrls, captureRestoreSnapshot, checkRestoredMigrations, compareRestoreSnapshots, createRestoreTestCopy } from "../packages/db/src/restore-verification.ts";
import { latestFullBackup, OpsRunner, readOpsConfig, required } from "./common.ts";
import { takeBackup } from "./backup.ts";
import { restoreBackup } from "./restore.ts";
import { createMediaStorage } from "../packages/media/src/storage-config.ts";
import { mediaLocation, restoredMediaEnvironment, verifyRawSamples } from "../packages/media/src/restore.ts";

export async function verifyRestore(env: NodeJS.ProcessEnv = process.env) {
  if (env.SOURCE_WRITERS_STOPPED !== "yes") throw new Error("Stop Hub, workers and all other source writers; then set SOURCE_WRITERS_STOPPED=yes.");
  const sourceUrl = required("SOURCE_MIGRATOR_URL", env), restoredMigrator = required("RESTORE_MIGRATOR_URL", env), restoredApp = required("RESTORE_APP_URL", env);
  assertIsolatedRestoreUrls(sourceUrl, restoredMigrator, restoredApp);
  const testMigrator = required("RESTORE_TEST_MIGRATOR_URL", env), testApp = required("RESTORE_TEST_APP_URL", env), restoreAdmin = env.RESTORE_ADMIN_URL ?? restoredMigrator;
  assertRestoreTestCopyUrls(restoredMigrator, testMigrator, testApp, restoreAdmin);
  const runner = new OpsRunner(readOpsConfig(env));
  if (!runner.config.container && Number(new URL(restoredMigrator).port || 5432) !== runner.config.restorePort) throw new Error("Restore URL port differs from RESTORE_PORT.");
  await runner.assertCleanRestoreDirectory();
  const reportPath = required("RESTORE_REPORT", env);
  // Reserve a new report, never overwrite an earlier restore record.
  const report = { startedAt: new Date().toISOString(), backupSet: "", checksumsMatch: false, countsMatch: false, mediaHashesMatch: false, sampledRawFiles: 0, testDatabase: "", testsPassed: false };
  await writeFile(reportPath, JSON.stringify(report, null, 2), { flag: "wx", mode: 0o600 });
  let started = false;
  try {
    const source = await captureRestoreSnapshot(sourceUrl);
    checkRestoredMigrations(source);
    if (source.mediaSamples.length) await verifyRawSamples(source.mediaSamples, createMediaStorage(env), { sourceVersions: true });
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
    if (source.mediaSamples.length) {
      const mediaEnv = restoredMediaEnvironment(env);
      if (mediaLocation(env) === mediaLocation(mediaEnv)) throw new Error("Media recovery target must differ from source storage.");
      const verified = await verifyRawSamples(source.mediaSamples, createMediaStorage(mediaEnv), { databaseSamples: restored.mediaSamples });
      report.sampledRawFiles = verified.sampledFiles;
    }
    report.mediaHashesMatch = true;
    // Keep the recovered database unchanged; tests use a fresh empty _test database
    // on the recovered server, then the test harness applies migrations and deterministic seeds.
    report.testDatabase = await createRestoreTestCopy(restoredMigrator, testMigrator, testApp, restoreAdmin);
    const testEnv: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      USER: process.env.USER,
      LOGNAME: process.env.LOGNAME,
      SHELL: process.env.SHELL,
      TMPDIR: process.env.TMPDIR,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      CI: process.env.CI,
      NODE_ENV: "test",
      DATABASE_URL: testApp,
      DATABASE_MIGRATOR_URL: testMigrator
    };
    await runner.command("corepack", ["pnpm", "test"], { local: true, env: testEnv });
    report.testsPassed = true;
    await writeFile(reportPath, JSON.stringify({ ...report, finishedAt: new Date().toISOString(), source, restored }, null, 2));
  } finally {
    if (!report.testsPassed) await writeFile(reportPath, JSON.stringify({ ...report, finishedAt: new Date().toISOString() }, null, 2));
    if (started) await runner.command("pg_ctl", ["-D", runner.config.restorePath, "-m", "fast", "-w", "stop"]);
  }
  console.log(`Restore verified; report: ${reportPath}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyRestore().catch((error: Error) => { console.error("Khidi operation failed; inspect configuration and service health."); process.exitCode = 1; });
}
