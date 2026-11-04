import { createInterface } from "node:readline/promises";
import { Writable, type Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { inspectRecoveryUser, recoverUser, type RecoveryInput } from "../packages/auth/src/recovery.ts";
import { assertRecoveryConsole, RecoverySafetyError } from "../packages/auth/src/recovery-safety.ts";
import { AppError } from "../packages/shared/src/index.ts";
import { connectMigratorDatabase } from "../packages/db/src/client.ts";

export interface RecoveryTerminal {
  question(prompt: string): Promise<string>;
  hidden(prompt: string): Promise<string>;
  write(message: string): void;
  close(): void;
}

class RecoveryConsoleError extends Error {}

export function recoveryErrorMessage(error: unknown): string {
  return error instanceof RecoverySafetyError || error instanceof RecoveryConsoleError || error instanceof AppError
    ? error.message : "Recovery did not complete. Check database configuration and permissions. No partial recovery was committed.";
}

export function createRecoveryTerminal(input: Readable, destination: Writable): RecoveryTerminal {
  let muted = false;
  const output = new Writable({ write(chunk, encoding, done) {
    if (!muted) destination.write(chunk, encoding);
    done();
  } });
  const terminal = createInterface({ input, output, terminal: true, historySize: 0 });
  terminal.on("SIGINT", () => terminal.close());
  return {
    question: (prompt) => terminal.question(prompt),
    async hidden(prompt) {
      destination.write(prompt);
      muted = true;
      try { return await terminal.question(""); }
      finally { muted = false; destination.write("\n"); }
    },
    write: (message) => { destination.write(`${message}\n`); },
    close: () => terminal.close()
  };
}

interface RecoveryServices {
  inspect(email: string): ReturnType<typeof inspectRecoveryUser>;
  recover(input: RecoveryInput): ReturnType<typeof recoverUser>;
}

/** Injectable I/O boundary; tests use a fake TTY and never invoke production recovery. */
export async function runRecoveryConsole(options: {
  env: NodeJS.ProcessEnv; args: string[]; inputTty?: boolean; outputTty?: boolean;
  terminal: RecoveryTerminal; services: RecoveryServices;
}) {
  assertRecoveryConsole(options.env, options.args, options.inputTty, options.outputTty);
  const { terminal, services } = options;
  const yes = async (prompt: string) => (await terminal.question(`${prompt} Type YES to select: `)).trim() === "YES";
  const email = (await terminal.question("Target user email: ")).trim().toLowerCase();
  const target = await services.inspect(email);
  terminal.write(`Recovery target: ${target.email}. No changes have been made.`);
  const resetTotp = target.canResetTotp && await yes("Reset TOTP and require enrollment at next login?");
  let newPassword: string | undefined;
  if (target.canSetPassword && await yes("Set a new office password?")) {
    newPassword = await terminal.hidden("New password (12+ characters, at most 72 UTF-8 bytes, no echo): ");
    if (newPassword !== await terminal.hidden("Repeat new password: ")) throw new RecoveryConsoleError("Passwords differ. No changes were made.");
  }
  const revokeSessions = await yes("Revoke ALL user sessions?");
  if (!resetTotp && newPassword === undefined && !revokeSessions) throw new RecoveryConsoleError("No actions selected. No changes were made.");
  const note = await terminal.question("Operator note (required; no passwords or secrets): ");
  const confirmationEmail = await terminal.question(`To commit the selected actions, type ${target.email} again: `);
  if (confirmationEmail.trim().toLowerCase() !== target.email) throw new RecoveryConsoleError("Email confirmation does not match. No changes were made.");
  const result = await services.recover({ email, confirmationEmail, resetTotp, newPassword, revokeSessions, note });
  terminal.write("Recovery completed and audited. TOTP reset requires enrollment before the next session. Existing lockout timers are unchanged.");
  return result;
}

async function main() {
  // Preflight before constructing a pool or starting interactive input.
  assertRecoveryConsole(process.env, process.argv.slice(2), process.stdin.isTTY, process.stdout.isTTY);
  const connection = connectMigratorDatabase();
  const terminal = createRecoveryTerminal(process.stdin, process.stdout);
  try {
    await runRecoveryConsole({ env: process.env, args: process.argv.slice(2), inputTty: process.stdin.isTTY,
      outputTty: process.stdout.isTTY, terminal,
      services: { inspect: (email) => inspectRecoveryUser(connection.db, email), recover: (input) => recoverUser(connection.db, input) } });
  } finally { terminal.close(); await connection.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    // Do not print driver/validation errors: they can embed credentials or bound parameters.
    console.error(recoveryErrorMessage(error));
    process.exitCode = 1;
  });
}
