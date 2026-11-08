import { spawn } from "node:child_process";
import { lstat, readdir, realpath } from "node:fs/promises";
import path from "node:path";

export interface OpsConfig {
  stanza: string; config: string; container?: string; sourcePath: string;
  restorePath: string; restoreRoot: string; restorePort: number;
}
export function required(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
export function readOpsConfig(env: NodeJS.ProcessEnv = process.env): OpsConfig {
  const stanza = env.PGBACKREST_STANZA || "khidi";
  if (!/^[a-zA-Z0-9_-]+$/.test(stanza)) throw new Error("Invalid stanza name.");
  const port = Number(env.RESTORE_PORT || "5436");
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid restore port.");
  return { stanza, config: required("PGBACKREST_CONFIG", env), container: env.OPS_DOCKER_CONTAINER || undefined,
    sourcePath: env.SOURCE_PGDATA || "", restorePath: env.RESTORE_PGDATA || "", restoreRoot: env.RESTORE_ROOT || "", restorePort: port };
}

export class OpsRunner {
  constructor(readonly config: OpsConfig) {}
  async command(program: string, args: string[], options: { capture?: boolean; env?: NodeJS.ProcessEnv; local?: boolean } = {}): Promise<string> {
    let executable = program, commandArgs = args;
    if (this.config.container && !options.local) {
      executable = "docker"; commandArgs = ["exec", "--user", "postgres", this.config.container, program, ...args];
    }
    if (options.local && process.platform === "win32" && program === "corepack") {
      if (program !== "corepack" || args.length !== 2 || args[0] !== "pnpm" || args[1] !== "test") throw new Error("Unsupported Windows local command.");
      executable = process.env.ComSpec ?? "cmd.exe";
      commandArgs = ["/d", "/s", "/c", "corepack pnpm test"];
    }
    return new Promise((resolve, reject) => {
      const child = spawn(executable, commandArgs, { stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
        env: options.env ?? process.env, shell: false,windowsHide:true });
      let stdout = "", stderr = "";
      child.stdout?.on("data", (data: Buffer) => { stdout += data.toString(); });
      child.stderr?.on("data", (data: Buffer) => { stderr += data.toString(); });
      child.on("error", reject);
      child.on("exit", (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(`${program} failed (exit ${code}). ${options.capture ? stderr.trim() : ""}`)));
    });
  }
  pgbackrest(args: string[], capture = false) {
    return this.command("pgbackrest", [`--config=${this.config.config}`, `--stanza=${this.config.stanza}`, ...args], { capture });
  }
  async assertCleanRestoreDirectory() {
    const { config } = this;
    const fsPath = config.container ? path.posix : path;
    for (const value of [config.sourcePath, config.restorePath, config.restoreRoot]) {
      if (!value || !fsPath.isAbsolute(value)) throw new Error("Source, restore and restore-root paths must be absolute.");
    }
    const canonical = async (value: string) => config.container
      ? this.command("realpath", ["-e", value], { capture: true }) : realpath(value);
    const [source, target, root] = await Promise.all([canonical(config.sourcePath), canonical(config.restorePath), canonical(config.restoreRoot)]);
    const inside = (base: string, item: string) => { const relative = fsPath.relative(base, item); return relative !== "" && relative !== ".." && !relative.startsWith(`..${fsPath.sep}`) && !fsPath.isAbsolute(relative); };
    if (root === fsPath.parse(root).root || !inside(root, target) || source === target || inside(source, target) || inside(target, source)) throw new Error("Restore directory must be inside its dedicated root and separate from source PGDATA.");
    if (config.container) {
      if ((await this.command("stat", ["--format=%F", config.restorePath], { capture: true })) !== "directory") throw new Error("Restore target must be a real directory.");
      if (await this.command("find", [target, "-mindepth", "1", "-maxdepth", "1", "-print", "-quit"], { capture: true })) throw new Error("Restore directory must be empty.");
    } else {
      if (!(await lstat(config.restorePath)).isDirectory() || (await lstat(config.restorePath)).isSymbolicLink()) throw new Error("Restore target must be a real directory.");
      if ((await readdir(target)).length) throw new Error("Restore directory must be empty.");
    }
  }
}

export function latestFullBackup(info: unknown, stanza: string): string {
  const entries = info as { name: string; status: { code: number }; backup: { label: string; type: string; timestamp: { stop: number } }[] }[];
  const entry = Array.isArray(entries) ? entries.find((row) => row.name === stanza) : null;
  if (!entry || entry.status?.code !== 0) throw new Error("Backup stanza is not healthy.");
  const latest = entry.backup?.filter((backup) => backup.type === "full").sort((a, b) => b.timestamp.stop - a.timestamp.stop)[0];
  if (!latest || !/^\d{8}-\d{6}F$/.test(latest.label)) throw new Error("No completed full backup found.");
  return latest.label;
}
