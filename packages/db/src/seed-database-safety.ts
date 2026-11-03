/** Pure guard. Both seed entry points call this before creating a database client. */
export function assertSeedDatabaseSafety(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === "production") throw new Error("SAFETY: Development seeds are forbidden in production.");
  for (const key of ["DATABASE_URL", "DATABASE_MIGRATOR_URL"] as const) {
    const value = env[key]?.trim();
    if (!value) throw new Error(`SAFETY: ${key} is required for seeds; database defaults are forbidden.`);
    let database: string;
    try {
      const url = new URL(value);
      if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || url.hash || !/^\/[^/]+$/.test(url.pathname)) throw new Error();
      decodeURIComponent(url.username); decodeURIComponent(url.password); decodeURIComponent(url.hostname);
      if (/[\u0000-\u001f\u007f/\\]/u.test(decodeURIComponent(url.pathname.slice(1)))) throw new Error();
      database = decodeURI(url.pathname.slice(1));
      for (const name of url.searchParams.keys()) if (["database", "dbname", "connectionstring", "host", "port", "service"].includes(name.toLowerCase())) throw new Error();
    } catch { throw new Error(`SAFETY: ${key} must be a valid PostgreSQL URL with one explicit database name and no connection overrides.`); }
    if (Buffer.byteLength(database, "utf8") > 63) throw new Error(`SAFETY: ${key} database name exceeds PostgreSQL's 63-byte limit.`);
    if (!database.endsWith("_dev") && !database.endsWith("_test")) throw new Error(`SAFETY: ${key} must identify a dedicated database ending in _dev or _test.`);
  }
}
