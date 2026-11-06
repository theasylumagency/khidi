import type { EvidenceValue } from "@khidi/db";
import type { AiJobName } from "./job-names.ts";

export interface ProviderInput {
  task: Exclude<AiJobName, "process-images">;
  promptVersion: string;
  fieldNames: string[];
  photo?: { mimeType: "image/jpeg" | "image/webp"; bytes: Uint8Array };
}

export interface ProviderResult {
  candidates: Record<string, EvidenceValue>;
  photoQuality?: { fullyInFrame: boolean; labelReadable: boolean; consistent: boolean };
  inputTokens: number;
  outputTokens: number;
  costUsdMicros: number;
}

export interface AiProvider {
  provider: string;
  model: string;
  /** Upper bound for one request, inclusive of its enforced input/output limits. */
  reserveCostUsdMicros(input: ProviderInput): number;
  run(input: ProviderInput): Promise<ProviderResult>;
}

export function configuredAiProvider(env: NodeJS.ProcessEnv = process.env): AiProvider | null {
  if (!env.AI_PROVIDER || env.AI_PROVIDER === "disabled") return null;
  if (env.AI_PROVIDER !== "synthetic") throw new Error("Only the local synthetic AI provider is available in M5.");
  return {
    provider: "synthetic", model: env.AI_MODEL || "fixture-v1", reserveCostUsdMicros: () => 0,
    async run() { return { candidates: {}, inputTokens: 0, outputTokens: 0, costUsdMicros: 0 }; }
  };
}

export function aiDailyCap(env: NodeJS.ProcessEnv = process.env) {
  const raw = env.AI_DAILY_BUDGET_USD_MICROS ?? "0", cap = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(cap) || cap < 0) throw new Error("Invalid AI_DAILY_BUDGET_USD_MICROS.");
  return cap;
}
