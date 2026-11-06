import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { aiJobLogs, aiJobs, evidence, imageMasterVersions, productImages, productTypes, scanTasks, skus,
  type DbExecutor, type EvidenceValue } from "@khidi/db";
import { withDomainTransaction, type DomainTransactionContext } from "@khidi/domain";
import { applyAiEvidenceCandidates } from "@khidi/evidence";
import { assertProcessedAiImage, queueMediaJob } from "@khidi/media";
import type { MediaStorage } from "@khidi/media/storage";
import { AppError, createUuidV7 } from "@khidi/shared";
import { t } from "@khidi/i18n";
import { AI_JOB_NAMES, type AiJobName } from "./job-names.ts";
import { aiDailyCap, type AiProvider, type ProviderInput, type ProviderResult } from "./provider.ts";

const promptVersion = "evidence-v1";
const photoJobs = new Set<AiJobName>(["extract-evidence", "ocr-label", "analyze-photo-quality", "process-images"]);
const readingJobs = new Set<AiJobName>(["extract-evidence", "ocr-label"]);
type Job = typeof aiJobs.$inferSelect;
const forbiddenField = /price|amount|commercial|invoice|packing|cost|currency|phone|email|address/i;

async function emitJob(ctx: DomainTransactionContext, job: Pick<Job, "id" | "generation" | "jobName" | "skuId">) {
  await ctx.emitOutboxEvent({ eventType: "AI_JOB_REQUESTED", aggregateType: "ai_job", aggregateId: job.id,
    payload: { jobId: job.id, jobName: job.jobName, generation: job.generation }, consumers: ["ai-jobs"] });
}

export async function queueAiJob(ctx: DomainTransactionContext, input: {
  jobName: AiJobName; skuId: string; evidenceId?: string; imageId?: string; imageVersion?: number;
}) {
  if (!AI_JOB_NAMES.includes(input.jobName)) throw new AppError("VALIDATION_ERROR", "Unknown AI job.");
  if (input.evidenceId) {
    const [item] = await ctx.tx.select().from(evidence).where(and(eq(evidence.id, input.evidenceId), eq(evidence.skuId, input.skuId)));
    if (!item || item.sensitivity !== "AI_ALLOWED" || item.status === "REJECTED") throw new AppError("FORBIDDEN", "Evidence is not allowed for provider processing.");
    if (input.imageId !== item.imageId) throw new AppError("VALIDATION_ERROR", "Image must belong to the evidence item.");
  }
  if (readingJobs.has(input.jobName) && !input.evidenceId) throw new AppError("VALIDATION_ERROR", "Reading requires an evidence item.");
  if (photoJobs.has(input.jobName) && !input.imageId) throw new AppError("VALIDATION_ERROR", "Job requires a processed image version.");
  if (input.imageId) {
    const [photo] = await ctx.tx.select({ id: productImages.id }).from(productImages)
      .where(and(eq(productImages.id, input.imageId), eq(productImages.skuId, input.skuId)));
    if (!photo || !Number.isSafeInteger(input.imageVersion) || input.imageVersion! < 1) throw new AppError("VALIDATION_ERROR", "Invalid image target.");
  }
  const dedupeKey = [input.jobName, input.skuId, input.evidenceId, input.imageId, input.imageVersion, promptVersion].join(":");
  const [job] = await ctx.tx.insert(aiJobs).values({ id: createUuidV7(), ...input, dedupeKey }).onConflictDoNothing().returning();
  if (!job) return (await ctx.tx.select({ id: aiJobs.id }).from(aiJobs).where(eq(aiJobs.dedupeKey, dedupeKey)))[0]!.id;
  await ctx.recordAudit({ action: "AI_JOB_QUEUED", entityType: "ai_job", entityId: job.id, after: { jobName: job.jobName, skuId: job.skuId } });
  await emitJob(ctx, job);
  return job.id;
}

async function prepareInput(db: DbExecutor, storage: MediaStorage, job: Job): Promise<ProviderInput> {
  if (job.jobName === "process-images") throw new Error("Image rendering is local.");
  const [sku] = await db.select({ productTypeId: skus.productTypeId, state: skus.lifecycleState }).from(skus).where(eq(skus.id, job.skuId));
  if (!sku || sku.state === "ARCHIVED") throw new AppError("PRECONDITION_FAILED", "SKU unavailable for provider processing.");
  const [type] = sku.productTypeId ? await db.select({ contract: productTypes.aiResearchContractJson })
    .from(productTypes).where(eq(productTypes.id, sku.productTypeId)) : [];
  const fieldNames = [...new Set([...(type?.contract.requiredIdentityFields ?? []), ...(type?.contract.targetSpecificationFields ?? [])])]
    .filter((field) => !forbiddenField.test(field));
  const input: ProviderInput = { task: job.jobName as ProviderInput["task"], promptVersion, fieldNames };
  let requiresDetail = readingJobs.has(job.jobName as AiJobName);
  if (job.evidenceId) {
    const [item] = await db.select({ type: evidence.type }).from(evidence)
      .where(and(eq(evidence.id, job.evidenceId), eq(evidence.skuId, job.skuId), eq(evidence.sensitivity, "AI_ALLOWED"), eq(evidence.status, "PENDING")));
    if (!item) throw new AppError("PRECONDITION_FAILED", "Evidence no longer eligible for provider processing.");
    requiresDetail ||= item.type === "PRODUCT_PLATE_PHOTO" || item.type === "PRODUCT_MARKING_PHOTO";
  }
  if (job.imageId && job.imageVersion) {
    const [image] = await db.select({ skuId: productImages.skuId, status: productImages.status, slot: productImages.slot })
      .from(productImages).where(eq(productImages.id, job.imageId));
    const [restricted] = await db.select({ id: evidence.id }).from(evidence)
      .where(and(eq(evidence.imageId, job.imageId), eq(evidence.sensitivity, "INTERNAL_ONLY"))).limit(1);
    if (image?.skuId !== job.skuId || image.status === "REJECTED" || restricted) {
      throw new AppError("FORBIDDEN", "Image is restricted from provider processing.");
    }
    const [master] = await db.select().from(imageMasterVersions)
      .where(and(eq(imageMasterVersions.imageId, job.imageId), eq(imageMasterVersions.version, job.imageVersion)));
    const prefix = `master/${job.imageId}/v${job.imageVersion}/`;
    if (!master || master.storageKey !== `${prefix}master.jpg`) throw new AppError("PRECONDITION_FAILED", "A processed master is required.");
    const derivative = requiresDetail || image.slot === "IDENTIFICATION" ? undefined : master.derivativesJson["800.webp"];
    const selected = derivative?.key === `${prefix}800.webp` && derivative.contentType === "image/webp" ? derivative : null;
    const mimeType = selected ? "image/webp" : "image/jpeg";
    const bytes = selected ? await storage.readPrivate(selected.key, selected.sha256, selected.versionId)
      : await storage.readPrivate(master.storageKey, master.sha256, master.storageVersionId ?? undefined);
    await assertProcessedAiImage(bytes, mimeType);
    input.photo = { mimeType, bytes };
  }
  return input;
}

function budgetDay(now: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tbilisi", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  return ["year", "month", "day"].map((part) => parts.find((value) => value.type === part)!.value).join("-");
}

async function recordState(ctx: DomainTransactionContext, job: Job, status: string, result?: Record<string, unknown>) {
  await ctx.tx.update(aiJobs).set({ status, result, updatedAt: new Date() }).where(eq(aiJobs.id, job.id));
  await ctx.recordAudit({ action: "AI_JOB_UPDATED", entityType: "ai_job", entityId: job.id, after: { status, generation: job.generation } });
  await ctx.emitOutboxEvent({ eventType: "AI_JOB_UPDATED", aggregateType: "ai_job", aggregateId: job.id,
    payload: { skuId: job.skuId, status }, consumers: status === "DEAD_LETTER" ? ["notifications"] : [] });
}

async function reserveAttempt(db: DbExecutor, job: Job, provider: { provider: string; model: string }, upperBound: number, cap: number) {
  if (!Number.isSafeInteger(upperBound) || upperBound < 0) throw new Error("Provider cost ceiling is invalid.");
  const day = budgetDay(new Date());
  return withDomainTransaction(db, {}, async (ctx) => {
    const [current] = await ctx.tx.select().from(aiJobs).where(eq(aiJobs.id, job.id)).for("update");
    if (!current || current.generation !== job.generation
      || (!["PENDING", "RETRY"].includes(current.status) && !(current.status === "RUNNING" && Date.now() - current.updatedAt.getTime() >= 300_000))) return null;
    await ctx.tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`khidi-ai-budget:${day}`}))`);
    const [usage] = await ctx.tx.select({ spent: sql<string>`COALESCE(SUM(COALESCE(${aiJobLogs.costUsdMicros}, ${aiJobLogs.reservedUsdMicros})), 0)` })
      .from(aiJobLogs).where(eq(aiJobLogs.budgetDay, day));
    const blocked = upperBound > 0 && BigInt(usage!.spent) + BigInt(upperBound) > BigInt(cap);
    const id = createUuidV7();
    await ctx.tx.insert(aiJobLogs).values({ id, jobId: job.id, generation: job.generation, provider: provider.provider, model: provider.model,
      promptVersion, budgetDay: day, reservedUsdMicros: blocked ? 0 : upperBound, costUsdMicros: blocked ? 0 : null,
      status: blocked ? "BUDGET_BLOCKED" : "RUNNING", completedAt: blocked ? new Date() : null });
    await recordState(ctx, job, blocked ? "BUDGET_BLOCKED" : "RUNNING");
    return blocked ? null : id;
  });
}

async function isCurrentAttempt(ctx: DomainTransactionContext, job: Job, attemptId: string) {
  const [current] = await ctx.tx.select().from(aiJobs).where(eq(aiJobs.id, job.id)).for("update");
  if (current?.generation !== job.generation || current.status !== "RUNNING") return false;
  const [latest] = await ctx.tx.select({ id: aiJobLogs.id }).from(aiJobLogs)
    .where(and(eq(aiJobLogs.jobId, job.id), eq(aiJobLogs.generation, job.generation)))
    .orderBy(desc(aiJobLogs.createdAt), desc(aiJobLogs.id)).limit(1);
  return latest?.id === attemptId;
}

function validatedResult(input: ProviderInput, raw: ProviderResult, upperBound: number) {
  if (![raw.inputTokens, raw.outputTokens, raw.costUsdMicros].every((value) => Number.isSafeInteger(value) && value >= 0)
    || raw.costUsdMicros > upperBound) throw new Error("Provider usage outside its reserved limit.");
  const candidates: Record<string, EvidenceValue> = {};
  for (const [key, value] of Object.entries(raw.candidates)) {
    if (!input.fieldNames.includes(key) || forbiddenField.test(key)) continue;
    if ((typeof value === "string" && value.trim() && value.length <= 400) || (typeof value === "number" && Number.isFinite(value))
      || typeof value === "boolean") candidates[key] = value;
  }
  const photoQuality = raw.photoQuality;
  return { candidates, ...(photoQuality && [photoQuality.fullyInFrame, photoQuality.labelReadable, photoQuality.consistent]
    .every((value) => typeof value === "boolean") ? { photoQuality } : {}) };
}

async function recordSemanticQuality(ctx: DomainTransactionContext, job: Job, quality: NonNullable<ProviderResult["photoQuality"]>) {
  if (!job.imageId) return;
  const [image] = await ctx.tx.select().from(productImages).where(eq(productImages.id, job.imageId)).for("update");
  if (!image || image.masterVersion !== job.imageVersion || image.status === "REJECTED") return;
  const needsRetake = !quality.fullyInFrame || !quality.consistent || (image.slot === "IDENTIFICATION" && !quality.labelReadable);
  await ctx.tx.update(productImages).set({ tier2QualityJson: { ...image.tier2QualityJson, semantic: quality, checkedVersion: job.imageVersion } })
    .where(eq(productImages.id, image.id));
  await ctx.recordAudit({ action: "IMAGE_TIER2_CHECKED", entityType: "product_image", entityId: image.id, after: { semantic: quality } });
  await ctx.emitOutboxEvent({ eventType: "IMAGE_TIER2_CHECKED", aggregateType: "product_image", aggregateId: image.id,
    payload: { imageId: image.id, skuId: job.skuId, needsRetake }, consumers: needsRetake ? ["notifications"] : [] });
  if (needsRetake) {
    const [open] = await ctx.tx.select({ id: scanTasks.id }).from(scanTasks).where(and(eq(scanTasks.targetSkuId, job.skuId),
      eq(scanTasks.taskType, "PHOTO_REQUEST"), inArray(scanTasks.status, ["OPEN", "IN_PROGRESS"]),
      sql`${scanTasks.requestedPhotoSlotsJson} @> ${JSON.stringify([image.slot])}::jsonb`)).limit(1);
    if (open) return;
    const id = createUuidV7();
    await ctx.tx.insert(scanTasks).values({ id, taskType: "PHOTO_REQUEST", title: t("evidence.photo_retake"),
      targetSkuId: job.skuId, assigneeRole: "WAREHOUSE", photosRequired: true, targetCount: 1, requestedPhotoSlotsJson: [image.slot],
      photoRequestNote: t("evidence.photo_retake_note"), createdBy: image.createdBy });
    await ctx.recordAudit({ action: "SCAN_TASK_CREATED", entityType: "scan_task", entityId: id, after: { imageId: image.id, jobId: job.id } });
    await ctx.emitOutboxEvent({ eventType: "SCAN_TASK_CREATED", aggregateType: "scan_task", aggregateId: id,
      payload: { skuId: job.skuId, taskType: "PHOTO_REQUEST" }, consumers: ["notifications"] });
  }
}

export async function executeAiJob(db: DbExecutor, storage: MediaStorage, provider: AiProvider | null, jobId: string, generation: number, cap = aiDailyCap()) {
  const [job] = await db.select().from(aiJobs).where(eq(aiJobs.id, jobId));
  if (!job || job.generation !== generation || !["PENDING", "RUNNING", "RETRY"].includes(job.status)) return;
  const local = job.jobName === "process-images";
  let input: ProviderInput | null = null;
  let preparationFailed = false;
  if (!local && provider) {
    try { input = await prepareInput(db, storage, job); }
    catch (error) { preparationFailed = !(error instanceof AppError); }
  }
  const selected = local ? { provider: "local", model: "sharp" } : provider ?? { provider: "disabled", model: "disabled" };
  const reserve = input && provider ? provider.reserveCostUsdMicros(input) : 0;
  const attempt = await reserveAttempt(db, job, selected, reserve, cap);
  if (!attempt) return;
  let usage: Pick<ProviderResult, "costUsdMicros" | "inputTokens" | "outputTokens"> | undefined;
  try {
    if (preparationFailed) throw new Error("Provider input could not be prepared.");
    const response = input && provider ? await provider.run(input) : null;
    const output = input && response ? validatedResult(input, response, reserve) : null;
    if (response) usage = { costUsdMicros: response.costUsdMicros, inputTokens: response.inputTokens, outputTokens: response.outputTokens };
    await withDomainTransaction(db, {}, async (ctx) => {
      const current = await isCurrentAttempt(ctx, job, attempt);
      const status = local || output ? "SUCCEEDED" : "SKIPPED";
      await ctx.tx.update(aiJobLogs).set({ status, costUsdMicros: response?.costUsdMicros ?? 0,
        inputTokens: response?.inputTokens ?? 0, outputTokens: response?.outputTokens ?? 0,
        completedAt: new Date(), errorCode: status === "SKIPPED" ? "PROVIDER_DISABLED_OR_INPUT_INELIGIBLE" : null }).where(eq(aiJobLogs.id, attempt));
      if (!current) {
        await ctx.recordAudit({ action: "AI_JOB_ATTEMPT_FINISHED", entityType: "ai_job", entityId: job.id, after: { attempt, status } });
        await ctx.emitOutboxEvent({ eventType: "AI_JOB_UPDATED", aggregateType: "ai_job", aggregateId: job.id, payload: { attempt }, consumers: [] });
        return;
      }
      if (local && job.imageId && job.imageVersion) await queueMediaJob(ctx, "process-image",
        { imageId: job.imageId, imageVersion: job.imageVersion }, `process-image:${job.imageId}:${job.imageVersion}`);
      if (job.evidenceId && output && Object.keys(output.candidates).length) await applyAiEvidenceCandidates(ctx, job.evidenceId, job.id, output.candidates);
      if (job.jobName === "analyze-photo-quality" && output?.photoQuality) await recordSemanticQuality(ctx, job, output.photoQuality);
      await recordState(ctx, job, status, output ?? undefined);
    });
  } catch {
    await withDomainTransaction(db, {}, async (ctx) => {
      // If the request failed after reaching the provider, its reservation remains charged.
      const current = await isCurrentAttempt(ctx, job, attempt);
      await ctx.tx.update(aiJobLogs).set({ status: "FAILED", ...usage, completedAt: new Date(), errorCode: "AI_JOB_FAILED" }).where(eq(aiJobLogs.id, attempt));
      if (current) await recordState(ctx, job, "RETRY");
      else {
        await ctx.recordAudit({ action: "AI_JOB_ATTEMPT_FINISHED", entityType: "ai_job", entityId: job.id, after: { attempt, status: "FAILED" } });
        await ctx.emitOutboxEvent({ eventType: "AI_JOB_UPDATED", aggregateType: "ai_job", aggregateId: job.id, payload: { attempt }, consumers: [] });
      }
    });
    throw new Error("Khidi AI job failed.");
  }
}

export async function markAiJobDeadLetter(db: DbExecutor, jobId: string, generation: number) {
  await withDomainTransaction(db, {}, async (ctx) => {
    const [job] = await ctx.tx.select().from(aiJobs).where(eq(aiJobs.id, jobId)).for("update");
    if (job?.generation === generation && ["PENDING", "RETRY", "RUNNING"].includes(job.status)) await recordState(ctx, job, "DEAD_LETTER");
  });
}

export async function retryAiJob(ctx: DomainTransactionContext, id: string) {
  const [job] = await ctx.tx.select().from(aiJobs).where(eq(aiJobs.id, id)).for("update");
  if (!job || !["DEAD_LETTER", "BUDGET_BLOCKED", "SKIPPED"].includes(job.status)) throw new AppError("PRECONDITION_FAILED", "Only failed or deferred AI jobs can be retried.");
  await ctx.tx.update(aiJobs).set({ generation: job.generation + 1, status: "PENDING", result: null, updatedAt: new Date() }).where(eq(aiJobs.id, id));
  await ctx.recordAudit({ action: "AI_JOB_RETRIED", entityType: "ai_job", entityId: id, after: { generation: job.generation + 1 } });
  await emitJob(ctx, { ...job, generation: job.generation + 1 });
}

export async function listAiJobs(db: DbExecutor) {
  const jobs = await db.select().from(aiJobs).orderBy(desc(aiJobs.updatedAt)).limit(100);
  const attempts = jobs.length ? await db.select().from(aiJobLogs).where(inArray(aiJobLogs.jobId, jobs.map((job) => job.id))).orderBy(desc(aiJobLogs.createdAt)) : [];
  return jobs.map((job) => ({ ...job, attempts: attempts.filter((attempt) => attempt.jobId === job.id) }));
}
