import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { assertTestDatabaseSafety } from "./test-database-safety.ts";

export const CORE_RESTORE_TABLES = [
  "legal_entities", "storefronts", "users", "product_families", "product_types", "skus",
  "sku_identifiers", "accounting_mappings", "storefront_listings", "sku_slug_history",
  "scan_tasks", "product_intakes", "label_events", "intake_review_actions", "audit_logs", "outbox_events", "outbox_deliveries",
  "product_images", "image_master_versions", "intake_photo_status", "media_jobs", "media_actions", "image_publications"
] as const;
export interface RestoreSnapshot {
  database: string;
  capturedAt: string;
  rowCounts: Record<string, string>;
  migrations: { filename: string; checksum: string }[];
  mediaSamples: { id: string; key: string; sha256: string; bytes: number; versionId: string | null }[];
}
export async function captureRestoreSnapshot(connectionString: string): Promise<RestoreSnapshot> {
  const pool = new pg.Pool({ connectionString, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const { rows: databases } = await client.query<{ name: string }>("SELECT current_database() AS name");
    const { rows: tablespaces } = await client.query("SELECT spcname FROM pg_tablespace WHERE spcname NOT IN ('pg_default','pg_global')");
    if (tablespaces.length) throw new Error("Restore verification requires default tablespaces; provision explicit isolated mappings first.");
    const rowCounts: Record<string, string> = {};
    for (const table of CORE_RESTORE_TABLES) {
      const { rows } = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM public."${table}"`);
      rowCounts[table] = rows[0]!.count;
    }
    const { rows: migrations } = await client.query<{ filename: string; checksum: string }>("SELECT filename, checksum FROM _schema_migrations ORDER BY filename");
    const { rows: mediaSamples } = await client.query<{ id: string; key: string; sha256: string; bytes: number; versionId: string | null }>('SELECT id, raw_storage_key AS key, raw_sha256 AS sha256, raw_bytes AS bytes, raw_version_id AS "versionId" FROM product_images ORDER BY id LIMIT 25');
    await client.query("COMMIT");
    return { database: databases[0]!.name, capturedAt: new Date().toISOString(), rowCounts, migrations, mediaSamples };
  } finally { client.release(); await pool.end(); }
}

export function checkRestoredMigrations(snapshot: RestoreSnapshot, migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations")) {
  const files = readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort();
  const recorded = new Map(snapshot.migrations.map((row) => [row.filename, row.checksum]));
  if (files.length !== recorded.size) throw new Error("Restored migration set differs from this checkout; no migrations have been applied.");
  for (const file of files) {
    const expected = createHash("sha256").update(readFileSync(join(migrationsDir, file), "utf8")).digest("hex");
    if (recorded.get(file) !== expected) throw new Error(`Restored migration checksum mismatch: ${file}`);
  }
}

export function compareRestoreSnapshots(source: RestoreSnapshot, restored: RestoreSnapshot) {
  if (source.database !== restored.database) throw new Error("Restored database name differs from the source.");
  for (const table of CORE_RESTORE_TABLES) {
    if (!source.rowCounts[table] || source.rowCounts[table] !== restored.rowCounts[table]) {
      throw new Error(`Restored row count mismatch: ${table} (source ${source.rowCounts[table]}, restored ${restored.rowCounts[table]}).`);
    }
  }
}

export function assertIsolatedRestoreUrls(sourceValue: string, migratorValue: string, appValue: string) {
  const parse = (value: string) => {
    let url: URL;
    try { url = new URL(value); } catch { throw new Error("Invalid database URL."); }
    if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("A PostgreSQL URL is required.");
    return url;
  };
  const source = parse(sourceValue), migrator = parse(migratorValue), app = parse(appValue);
  const host = (url: URL) => ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ? "loopback" : url.hostname;
  const endpoint = (url: URL) => `${host(url)}:${url.port || "5432"}${url.pathname}`;
  if (host(migrator) !== "loopback" || host(app) !== "loopback") throw new Error("Verification targets must listen on loopback.");
  if (endpoint(source) === endpoint(migrator)) throw new Error("Refusing to test against the source database.");
  if (endpoint(app) !== endpoint(migrator)) throw new Error("Restored app and migrator URLs must identify the same database.");
  if (decodeURIComponent(migrator.username) !== "hub_migrator" || decodeURIComponent(app.username) !== "hub_app") throw new Error("Use the separate hub_migrator and hub_app roles for verification.");
}
export function assertRestoreTestCopyUrls(restoredValue: string, migratorValue: string, appValue: string, adminValue = restoredValue) {
  assertTestDatabaseSafety({ NODE_ENV: "test", DATABASE_URL: appValue, DATABASE_MIGRATOR_URL: migratorValue });
  assertIsolatedRestoreUrls(restoredValue, migratorValue, appValue);
  const values = [restoredValue, migratorValue, appValue, adminValue].map((value) => {
    const url = new URL(value);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || url.hash || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Restore copy connections must use loopback PostgreSQL.");
    for (const name of url.searchParams.keys()) if (["host", "port", "database", "dbname", "connectionstring", "service"].includes(name.toLowerCase())) throw new Error("Restore copy connection overrides are forbidden.");
    return url;
  });
  if (values.some((url) => (url.port || "5432") !== (values[0]!.port || "5432"))) throw new Error("The verification test copy must stay on the restored server.");
  return { restoredDatabase: decodeURI(values[0]!.pathname.slice(1)), testDatabase: decodeURI(values[1]!.pathname.slice(1)), admin: values[3]! };
}
/** Infrastructure operation on the isolated restore server. Never drops/reuses a database. */
export async function createRestoreTestCopy(restoredValue: string, migratorValue: string, appValue: string, adminValue = restoredValue) {
  const config = assertRestoreTestCopyUrls(restoredValue, migratorValue, appValue, adminValue);
  const maintenance = new URL(config.admin); maintenance.pathname = "/postgres";
  const pool = new pg.Pool({ connectionString: maintenance.toString(), max: 1 });
  const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
  try {
    const existing = await pool.query("SELECT 1 FROM pg_database WHERE datname=$1", [config.testDatabase]);
    if (existing.rowCount) throw new Error("Restore test copy already exists; choose a new dedicated _test name. No database was changed.");
    await pool.query(`CREATE DATABASE ${quote(config.testDatabase)} WITH TEMPLATE ${quote(config.restoredDatabase)} OWNER hub_migrator`);
    await pool.query(`GRANT CONNECT ON DATABASE ${quote(config.testDatabase)} TO hub_app`);
    return config.testDatabase;
  } finally { await pool.end(); }
}
