import pg from "pg";
import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema.ts";

const { Pool } = pg;

const DEFAULT_APP_DB_URL =
  process.env.DATABASE_URL ??
  "postgres://hub_app:hub_app_dev_password@127.0.0.1:5435/agrotrade_hub";

const DEFAULT_MIGRATOR_DB_URL =
  process.env.DATABASE_MIGRATOR_URL ??
  "postgres://hub_migrator:hub_migrator_dev_password@127.0.0.1:5435/agrotrade_hub";

let appPoolSingleton: pg.Pool | null = null;
let appDbSingleton: NodePgDatabase<typeof schema> | null = null;

export function getAppPool(): pg.Pool {
  if (!appPoolSingleton) {
    appPoolSingleton = new Pool({
      connectionString: DEFAULT_APP_DB_URL,
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
    connectionString: DEFAULT_MIGRATOR_DB_URL,
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
