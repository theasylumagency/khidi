import { PassThrough, Writable } from "node:stream";
import { expect, it, vi } from "vitest";
import { assertRecoveryConsole } from "./recovery-safety.ts";
import type { RecoveryInput } from "./recovery.ts";
import { createRecoveryTerminal, recoveryErrorMessage, runRecoveryConsole } from "../../../ops/recover-user.ts";

const env = { NODE_ENV: "test", DATABASE_MIGRATOR_URL: "postgres://operator:synthetic@127.0.0.1/khidi_recovery_test" };

it.each([
  [env, ["--password=never-allowed"], true, true], [env, [], false, true], [env, [], true, false],
  [{ NODE_ENV: "production" }, [], true, true],
  [{ ...env, NODE_ENV: "production" }, [], false, true],
  [{ ...env, NODE_ENV: undefined, DATABASE_MIGRATOR_URL: "postgres://operator:p@shared.example/khidi" }, [], true, true],
  [{ ...env, DATABASE_MIGRATOR_URL: "postgres://operator:p@127.0.0.1/khidi" }, [], true, true],
  [{ ...env, DATABASE_MIGRATOR_URL: "postgres://operator:p@shared.example/khidi_test" }, [], true, true],
  [{ ...env, DATABASE_MIGRATOR_URL: "not-a-url" }, [], true, true],
  [{ ...env, DATABASE_MIGRATOR_URL: "postgres://operator:p@localhost/khidi_test?database=khidi" }, [], true, true],
  [{ ...env, DATABASE_MIGRATOR_URL: `postgres://operator:p@localhost/${"x".repeat(64)}_test` }, [], true, true]
] as const)("fails preflight safely (%#)", (config, args, input, output) => {
  expect(() => assertRecoveryConsole(config, [...args], input, output)).toThrow(/^SAFETY:/);
});

it("allows a real interactive production command and local development trials", () => {
  expect(() => assertRecoveryConsole({ NODE_ENV: "production", DATABASE_MIGRATOR_URL: "postgres://operator:p@shared.example/khidi" }, [], true, true)).not.toThrow();
  expect(() => assertRecoveryConsole({ DATABASE_MIGRATOR_URL: "postgres://operator:p@localhost/khidi_dev" }, [], true, true)).not.toThrow();
});

function consoleFixture(answers: string[], canResetTotp = true, canSetPassword = true) {
  const terminal = { question: vi.fn(async (_prompt: string) => answers.shift() ?? ""), hidden: vi.fn(async (_prompt: string) => "Synthetic-new-password-123"), write: vi.fn(), close: vi.fn() };
  const services = { inspect: vi.fn(async () => ({ email: "recover@khidi.example", canResetTotp, canSetPassword })),
    recover: vi.fn(async (_input: RecoveryInput) => ({ userId: "synthetic", actions: { resetTotp: true, passwordChanged: true, revokeSessions: true }, sessionsRevoked: 1 })) };
  return { env, args: [], inputTty: true, outputTty: true, terminal, services };
}

it("requires matching final email and separately confirmed actions", async () => {
  const options = consoleFixture(["recover@khidi.example", "YES", "YES", "YES", "Operator note", "wrong@khidi.example"]);
  await expect(runRecoveryConsole(options)).rejects.toThrow(/confirmation/);
  expect(options.services.recover).not.toHaveBeenCalled();
});

it("passes only interactive inputs to the core and never prints the password", async () => {
  const options = consoleFixture(["recover@khidi.example", "YES", "YES", "YES", "Operator note", "recover@khidi.example"]);
  await runRecoveryConsole(options);
  expect(options.services.recover).toHaveBeenCalledWith({ email: "recover@khidi.example", confirmationEmail: "recover@khidi.example",
    resetTotp: true, newPassword: "Synthetic-new-password-123", revokeSessions: true, note: "Operator note" });
  expect(options.terminal.hidden).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(options.terminal.write.mock.calls)).not.toContain("Synthetic-new-password-123");
});

it.each([true, false])("never offers ineligible TOTP reset (office password=%s)", async (office) => {
  const options = consoleFixture(["recover@khidi.example", ...(office ? ["no"] : []), "YES", "Operator note", "recover@khidi.example"], false, office);
  await runRecoveryConsole(options);
  expect(options.terminal.question.mock.calls.flat().join(" ")).not.toContain("Reset TOTP");
  expect(options.services.recover.mock.calls[0]?.[0]).toMatchObject({ resetTotp: false, newPassword: undefined, revokeSessions: true });
});

it("performs no lookup or recovery without a TTY", async () => {
  const options = consoleFixture([]);
  await expect(runRecoveryConsole({ ...options, inputTty: false })).rejects.toThrow(/^SAFETY:/);
  expect(options.services.inspect).not.toHaveBeenCalled(); expect(options.services.recover).not.toHaveBeenCalled();
});

it("reads the actual readline password without echo", async () => {
  const input = new PassThrough(); let output = "";
  const terminal = createRecoveryTerminal(input, new Writable({ write(chunk, _encoding, done) { output += chunk.toString(); done(); } }));
  try {
    const answer = terminal.hidden("New password: ");
    input.write("Synthetic-hidden-password-987\n");
    expect(await answer).toBe("Synthetic-hidden-password-987");
    expect(output).toContain("New password:"); expect(output).not.toContain("Synthetic-hidden-password-987");
  } finally { terminal.close(); input.destroy(); }
});

it("redacts unexpected driver errors instead of logging connection strings or bound passwords", () => {
  const message = recoveryErrorMessage(new Error("Failed query; password=Synthetic-sensitive-value; postgres://operator:private@server/db"));
  expect(message).not.toContain("Synthetic-sensitive-value"); expect(message).not.toContain("postgres://");
  expect(message).toContain("No partial recovery");
});
