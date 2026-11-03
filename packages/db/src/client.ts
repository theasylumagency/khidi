import pg from "pg";
import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema.ts";

const { Pool } = pg;

const DEV_FALLBACK_APP_DB_URL =
  "postgres://hub_app:hub_app_dev_password@127.0.0.1:5435/agrotrade_hub_dev";

const DEV_FALLBACK_MIGRATOR_DB_URL =
  "postgres://hub_migrator:hub_migrator_dev_password@127.0.0.1:5435/agrotrade_hub_dev";

export function resolveAppDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.DATABASE_URL?.trim();
  if (env.NODE_ENV === "production") {
    if (!configured) {
      throw new Error("CRITICAL: DATABASE_URL environment variable is required in production.");
    }
    if (configured.includes("hub_app_dev_password")) {
      throw new Error(
        "CRITICAL: DATABASE_URL must not use the default development password in production."
      );
    }
    return configured;
  }
  return configured || DEV_FALLBACK_APP_DB_URL;
}

export function resolveMigratorDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.DATABASE_MIGRATOR_URL?.trim();
  if (env.NODE_ENV === "production") {
    if (!configured) {
      throw new Error(
        "CRITICAL: DATABASE_MIGRATOR_URL environment variable is required in production."
      );
    }
    if (configured.includes("hub_migrator_dev_password")) {
      throw new Error(
        "CRITICAL: DATABASE_MIGRATOR_URL must not use the default development password in production."
      );
    }
    return configured;
  }
  return configured || DEV_FALLBACK_MIGRATOR_DB_URL;
}

let appPoolSingleton: pg.Pool | null = null;
let appDbSingleton: NodePgDatabase<typeof schema> | null = null;

export function getAppPool(): pg.Pool {
  if (!appPoolSingleton) {
    appPoolSingleton = new Pool({
      connectionString: resolveAppDatabaseUrl(),
      max: 10
    });
  }
  return appPoolSingleton;
}

export function getDb(): NodePgDatabase<typeof schema> {
  if (!appDbSingleton) {
    appDbSingleton = drizzle(getAppPool(), { schema });
  }
  return appDbSingleton;
}

export function createMigratorPool(): pg.Pool {
  return new Pool({
    connectionString: resolveMigratorDatabaseUrl(),
    max: 4
  });
}

export async function closeAppPool(): Promise<void> {
  if (appPoolSingleton) {
    await appPoolSingleton.end();
    appPoolSingleton = null;
    appDbSingleton = null;
  }
}

export async function checkDatabaseHealth(): Promise<boolean> {
  const db = getDb();
  await db.execute(sql`SELECT 1`);
  return true;
}

export type AppDatabase = NodePgDatabase<typeof schema>;
export type DbExecutor = AppDatabase | Parameters<Parameters<AppDatabase["transaction"]>[0]>[0];
