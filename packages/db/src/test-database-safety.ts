/** Pure validation: never imports a database client or connects to PostgreSQL. */
export function assertTestDatabaseSafety(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== "test") {
    throw new Error('SAFETY: Test database setup requires NODE_ENV === "test".');
  }

  for (const key of ["DATABASE_URL", "DATABASE_MIGRATOR_URL"] as const) {
    const value = env[key]?.trim();
    if (!value) throw new Error(`SAFETY: ${key} is required for tests; database defaults are forbidden.`);

    let database: string;
    try {
      const url = new URL(value);
      if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || url.hash
        || !/^\/[^/]+$/.test(url.pathname)) throw new Error("Invalid PostgreSQL URL.");
      // Validate encoding without including credentials or the original URL in errors.
      decodeURIComponent(url.username); decodeURIComponent(url.password); decodeURIComponent(url.hostname);
      const decoded = decodeURIComponent(url.pathname.slice(1));
      if (/[\u0000-\u001f\u007f/\\]/u.test(decoded)) throw new Error("Invalid database name.");
      database = decodeURI(url.pathname.slice(1)); // Match node-postgres's database decoding.
      // Do not accept an alternate database/connection hidden in query parameters.
      for (const parameter of url.searchParams.keys()) {
        if (["database", "dbname", "connectionstring", "host", "port", "service"].includes(parameter.toLowerCase())) throw new Error("Ambiguous database URL.");
      }
    } catch {
      throw new Error(`SAFETY: ${key} must be a valid PostgreSQL URL with one explicit database name and no connection overrides.`);
    }

    if (Buffer.byteLength(database, "utf8") > 63) {
      throw new Error(`SAFETY: ${key} database name must not exceed 63 UTF-8 bytes; the _test suffix must survive PostgreSQL's name limit.`);
    }
    if (!database.endsWith("_test")) {
      throw new Error(`SAFETY: ${key} must point to a dedicated database whose name ends with _test.`);
    }
  }
}
