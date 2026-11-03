import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { bootstrapFirstAdmin } from "../packages/auth/src/bootstrap.ts";
import { closeAppPool, getDb } from "../packages/db/src/client.ts";

export function assertBootstrapConsole(env: NodeJS.ProcessEnv, args: string[], inputTty: boolean | undefined, outputTty: boolean | undefined) {
  if (env.NODE_ENV !== "production") throw new Error("SAFETY: Admin bootstrap requires NODE_ENV=production.");
  if (args.length || !inputTty || !outputTty) throw new Error("SAFETY: Use an interactive terminal without arguments. Credentials are never read from arguments or environment variables.");
}
export async function runBootstrapConsole() {
  assertBootstrapConsole(process.env, process.argv.slice(2), process.stdin.isTTY, process.stdout.isTTY);
  let muted = false;
  const output = new Writable({ write(chunk, encoding, callback) { if (!muted) process.stdout.write(chunk, encoding); callback(); } });
  const terminal = createInterface({ input: process.stdin, output, terminal: true, historySize: 0 });
  terminal.on("SIGINT", () => terminal.close());
  const hidden = async (prompt: string) => {
    process.stdout.write(prompt); muted = true;
    try { return await terminal.question(""); }
    finally { muted = false; process.stdout.write("\n"); }
  };
  try {
    const email = await terminal.question("Admin email: ");
    const fullName = await terminal.question("Admin name: ");
    const password = await hidden("Password (12+ characters, no echo): ");
    if (password !== await hidden("Repeat password: ")) throw new Error("Passwords differ. No user was created.");
    await bootstrapFirstAdmin(getDb(), { email, fullName, password });
    console.log("First Khidi ADMIN created. First login requires authenticator enrollment and a valid TOTP code.");
  } finally { terminal.close(); await closeAppPool(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runBootstrapConsole().catch((error) => { console.error(error instanceof Error ? error.message : "Admin bootstrap failed."); process.exitCode = 1; });
}
