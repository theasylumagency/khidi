import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createMigratorPool } from "./client.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Fixed 64-bit PostgreSQL advisory lock key for schema migrations.
 * Prevents concurrent migration processes from colliding.
 */
const MIGRATION_ADVISORY_LOCK_KEY = "7845123901234567";

export interface MigrationRunResult {
  applied: string[];
  skipped: string[];
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export async function runMigrations(options?: {
  migrationsDir?: string;
}): Promise<MigrationRunResult> {
  const pool = createMigratorPool();
  const client = await pool.connect();
  const applied: string[] = [];
  const skipped: string[] = [];
  let lockAcquired = false;

  try {
    // 1. Acquire session-level PostgreSQL advisory lock so concurrent runners wait in order
    await client.query(`SELECT pg_advisory_lock($1::bigint)`, [MIGRATION_ADVISORY_LOCK_KEY]);
    lockAcquired = true;

    // 2. Ensure _schema_migrations tracking table exists with mandatory checksum column
    await client.query(`
      CREATE TABLE IF NOT EXISTS _schema_migrations (
        filename TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 3. Load already-applied migrations BEFORE executing any migration files
    const existingRows = await client.query<{ filename: string; checksum: string | null }>(
      `SELECT filename, checksum FROM _schema_migrations ORDER BY filename ASC`
    );
    const appliedMap = new Map<string, string | null>();
    for (const row of existingRows.rows) {
      appliedMap.set(row.filename, row.checksum);
    }

    const migrationsDir = options?.migrationsDir ?? join(__dirname, "..", "migrations");
    const files = readdirSync(/* turbopackIgnore: true */ migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const file of files) {
      const sqlContent = readFileSync(
        /* turbopackIgnore: true */ join(migrationsDir, file),
        "utf8"
      );
      const fileChecksum = sha256(sqlContent);

      if (appliedMap.has(file)) {
        const recordedChecksum = appliedMap.get(file);
        if (!recordedChecksum || recordedChecksum !== fileChecksum) {
          throw new Error(
            `Migration checksum mismatch for already-applied migration "${file}": expected ${recordedChecksum ?? "NULL"}, got ${fileChecksum}. Never modify an already-applied migration.`
          );
        }
        skipped.push(file);
        continue;
      }

      await client.query("BEGIN");
      try {
        await client.query(sqlContent);
        await client.query(
          `INSERT INTO _schema_migrations (filename, checksum) VALUES ($1, $2)`,
          [file, fileChecksum]
        );
        await client.query("COMMIT");
        applied.push(file);
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }
  } finally {
    if (lockAcquired) {
      try {
        await client.query(`SELECT pg_advisory_unlock($1::bigint)`, [MIGRATION_ADVISORY_LOCK_KEY]);
      } catch {
        // Ignore unlock error if connection already closed
      }
    }
    client.release();
    await pool.end();
  }

  return { applied, skipped };
}

if (
  import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}` ||
  process.argv[1]?.endsWith("migrate.ts")
) {
  runMigrations()
    .then(({ applied, skipped }) => {
      console.log(
        `Migrations complete — applied: [${applied.join(", ") || "none"}], skipped: [${skipped.join(", ") || "none"}]`
      );
    })
    .catch((err) => {
      console.error("Khidi migration failed; inspect configuration and database health.");
      process.exit(1);
    });
}
