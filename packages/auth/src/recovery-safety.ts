export class RecoverySafetyError extends Error {}

/** Pure preflight: must run before opening a database connection. */
export function assertRecoveryConsole(
  env: NodeJS.ProcessEnv, args: string[], inputTty: boolean | undefined, outputTty: boolean | undefined
): void {
  if (args.length || !inputTty || !outputTty) {
    throw new RecoverySafetyError("SAFETY: Recovery requires an interactive terminal without arguments. Secrets are never read from arguments or environment variables.");
  }
  const value = env.DATABASE_MIGRATOR_URL?.trim();
  if (!value) throw new RecoverySafetyError("SAFETY: DATABASE_MIGRATOR_URL is required; database defaults are forbidden.");
  let target: URL;
  let database: string;
  try {
    target = new URL(value);
    if (!["postgres:", "postgresql:"].includes(target.protocol) || !target.hostname || target.hash
      || !/^\/[^/]+$/.test(target.pathname)) throw new Error();
    decodeURIComponent(target.username); decodeURIComponent(target.password); decodeURIComponent(target.hostname);
    if (/[\u0000-\u001f\u007f/\\]/u.test(decodeURIComponent(target.pathname.slice(1)))) throw new Error();
    database = decodeURI(target.pathname.slice(1));
    if (Buffer.byteLength(database, "utf8") > 63) throw new Error();
    for (const key of target.searchParams.keys()) {
      if (["database", "dbname", "connectionstring", "host", "port", "service"].includes(key.toLowerCase())) throw new Error();
    }
  } catch {
    throw new RecoverySafetyError("SAFETY: DATABASE_MIGRATOR_URL must be a valid PostgreSQL URL with one explicit database and no connection overrides.");
  }
  if (env.NODE_ENV !== "production" && (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(target.hostname)
    || (!database.endsWith("_dev") && !database.endsWith("_test")))) {
    throw new RecoverySafetyError("SAFETY: Shared/production recovery requires NODE_ENV=production. Manual trials outside production require a local _dev or _test database.");
  }
}
