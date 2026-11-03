import { mkdtemp, mkdir, readdir, readFile, writeFile, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveMigratorDatabaseUrl } from "./client.ts";
import { assertIsolatedRestoreUrls, assertRestoreTestCopyUrls, captureRestoreSnapshot, checkRestoredMigrations, compareRestoreSnapshots } from "./restore-verification.ts";
import { OpsRunner, type OpsConfig } from "../../../ops/common.ts";
import { restoreBackup } from "../../../ops/restore.ts";
import { verifyRestore } from "../../../ops/verify-restore.ts";

describe("M3 S7 restore verification safeguards", () => {
  it("checks real database migration checksums without applying migrations and detects changed/pending files", async () => {
    const snapshot = await captureRestoreSnapshot(resolveMigratorDatabaseUrl());
    checkRestoredMigrations(snapshot);
    const directory = await mkdtemp(join(tmpdir(), "khidi-migration-check-"));
    try {
      const migrationDirectory = new URL("../migrations/", import.meta.url);
      for (const filename of await readdir(migrationDirectory)) {
        if (filename.endsWith(".sql")) await writeFile(join(directory, filename), await readFile(new URL(filename, migrationDirectory)));
      }
      checkRestoredMigrations(snapshot, directory);
      const file = snapshot.migrations[0]!.filename;
      await writeFile(join(directory, file), "-- changed synthetic copy\n");
      expect(() => checkRestoredMigrations(snapshot, directory)).toThrow(/checksum mismatch/);
      await writeFile(join(directory, "9999_pending.sql"), "SELECT 1;");
      expect(() => checkRestoredMigrations(snapshot, directory)).toThrow(/migration set differs/);
    } finally { for (const filename of await readdir(directory)) await unlink(join(directory, filename)); await rmdir(directory); }
  });
  it("compares all core tables, detects a missing row and refuses a different database", async () => {
    const snapshot = await captureRestoreSnapshot(resolveMigratorDatabaseUrl());
    const restored = structuredClone(snapshot);
    compareRestoreSnapshots(snapshot, restored);
    restored.rowCounts.product_intakes = String(BigInt(snapshot.rowCounts.product_intakes!) + 1n);
    expect(() => compareRestoreSnapshots(snapshot, restored)).toThrow(/product_intakes/);
    expect(() => compareRestoreSnapshots(snapshot, { ...snapshot, database: "other" })).toThrow(/database name/);
  });
  it("refuses source URLs, remote targets and mixing app/migrator target databases", () => {
    const source = "postgres://hub_migrator:local@localhost:5435/khidi";
    const restored = "postgres://hub_migrator:local@127.0.0.1:5436/khidi";
    const app = "postgres://hub_app:local@localhost:5436/khidi";
    expect(() => assertIsolatedRestoreUrls(source, restored, app)).not.toThrow();
    expect(() => assertIsolatedRestoreUrls(source, source.replace("localhost", "127.0.0.1"), source.replace("hub_migrator", "hub_app"))).toThrow(/source database/);
    expect(() => assertIsolatedRestoreUrls(source, restored.replace("127.0.0.1", "production.internal"), app)).toThrow(/loopback/);
    expect(() => assertIsolatedRestoreUrls(source, restored, app.replace("/khidi", "/wrong"))).toThrow(/same database/);
  });
  it("refuses a nonempty directory, source PGDATA and paths outside the dedicated restore root before invoking restore", async () => {
    const directory = await mkdtemp(join(tmpdir(), "khidi-restore-path-"));
    const source = join(directory, "source"), root = join(directory, "restore"), empty = join(root, "empty"), dirty = join(root, "dirty");
    for (const name of [source, root, empty, dirty]) await mkdir(name);
    await writeFile(join(dirty, "important.txt"), "preserve");
    const config: OpsConfig = { stanza: "khidi", config: "not-used", sourcePath: source, restoreRoot: root, restorePath: empty, restorePort: 5436 };
    try {
      await expect(new OpsRunner(config).assertCleanRestoreDirectory()).resolves.toBeUndefined();
      await expect(restoreBackup(new OpsRunner({ ...config, restorePath: dirty }), "20261102-100000F")).rejects.toThrow(/empty/);
      await expect(restoreBackup(new OpsRunner({ ...config, restorePath: source }), "20261102-100000F")).rejects.toThrow(/separate from source/);
      await expect(new OpsRunner({ ...config, restoreRoot: source }).assertCleanRestoreDirectory()).rejects.toThrow(/dedicated root/);
      expect(await readFile(join(dirty, "important.txt"), "utf8")).toBe("preserve");
    } finally { await unlink(join(dirty, "important.txt")); for (const name of [empty, dirty, root, source, directory]) await rmdir(name); }
  });
  it("requires an explicit source maintenance window before making a backup or restoring", async () => {
    await expect(verifyRestore({})).rejects.toThrow(/Stop Hub, workers/);
  });
  it("allows verification only on a separate _test database on the recovered server", () => {
    const recovered = "postgres://hub_migrator:local@127.0.0.1:5437/khidi", migrator = "postgres://hub_migrator:local@localhost:5437/khidi_recovery_test", app = migrator.replace("hub_migrator", "hub_app");
    expect(assertRestoreTestCopyUrls(recovered, migrator, app).testDatabase).toBe("khidi_recovery_test");
    expect(() => assertRestoreTestCopyUrls(recovered, recovered, recovered.replace("hub_migrator", "hub_app"))).toThrow(/SAFETY:/);
    expect(() => assertRestoreTestCopyUrls(recovered, migrator.replace("5437", "5435"), app.replace("5437", "5435"))).toThrow(/restored server/);
    expect(() => assertRestoreTestCopyUrls(recovered, migrator, app, recovered.replace("127.0.0.1", "production.internal"))).toThrow(/loopback/);
    expect(() => assertRestoreTestCopyUrls(recovered + "?host=production.internal", migrator, app)).toThrow(/overrides/);
  });
});
