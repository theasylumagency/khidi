import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { productTypes, skuContentApprovals, skuContentVersions, skus, users, type CanonicalContentOrigin, type DbExecutor } from "@khidi/db";
import { withDomainTransaction, type DomainActor, type DomainTransactionContext } from "@khidi/domain";
import { compareApprovedContentFacts, evidenceFieldOptions, getApprovedContent, getContentFactFields,
  lockIdentityCatalog, refreshSkuContentReview } from "@khidi/evidence";
import { AppError, createUuidV7 } from "@khidi/shared";
import {
  generateCanonicalDraft, isPublicCanonicalField, isPublicCanonicalText, validateCanonicalDraft,
  type CanonicalContentContext, type CanonicalDraft, type CanonicalFact
} from "./content-validation.ts";

export const contentLocale = z.string().trim().toLowerCase().max(35).regex(/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/);
const contentDraft = z.object({
  displayName: z.string().trim().max(300),
  shortDescription: z.string().trim().max(2000),
  fullDescription: z.string().trim().max(12_000),
  searchAliases: z.array(z.string().trim().min(1).max(160)).max(60)
}).strict();
const versionRequest = z.object({ skuId: z.string().uuid(), locale: contentLocale, draft: contentDraft.optional() }).strict();
const approvalRequest = z.object({ skuId: z.string().uuid(), versionId: z.string().uuid() }).strict();
const factLabels: Record<string, [string, string]> = {
  brand: ["ბრენდი", "Brand"], model_code: ["მოდელი", "Model"], manufacturer: ["მწარმოებელი", "Manufacturer"],
  product_type: ["პროდუქტის ტიპი", "Product type"], power_kw: ["სიმძლავრე", "Power"],
  engine_displacement_cm3: ["ძრავის მოცულობა", "Engine displacement"],
  length_mm: ["სიგრძე", "Length"], width_mm: ["სიგანე", "Width"], height_mm: ["სიმაღლე", "Height"],
  working_width_mm: ["სამუშაო სიგანე", "Working width"], working_depth_mm: ["სამუშაო სიღრმე", "Working depth"],
  weight_kg: ["წონა", "Weight"], volume_l: ["მოცულობა", "Volume"], pressure_bar: ["წნევა", "Pressure"],
  flow_l_min: ["ნაკადი", "Flow"], voltage_v: ["ძაბვა", "Voltage"], current_a: ["დენი", "Current"]
};

async function assertContentAdmin(ctx: DomainTransactionContext, actor: DomainActor) {
  const [admin] = actor.userId ? await ctx.tx.select({ id: users.id }).from(users)
    .where(and(eq(users.id, actor.userId), eq(users.role, "ADMIN"), eq(users.active, true))) : [];
  if (!admin) throw new AppError("FORBIDDEN", "Canonical content changes require an active admin.");
  return admin.id;
}

export async function getCanonicalContentContext(db: DbExecutor, skuId: string): Promise<CanonicalContentContext> {
  const [item] = await db.select({ sku: skus, type: productTypes }).from(skus)
    .leftJoin(productTypes, eq(productTypes.id, skus.productTypeId)).where(eq(skus.id, skuId));
  if (!item) throw new AppError("NOT_FOUND", "SKU not found.");
  const { sku, type } = item;
  const fields = await getContentFactFields(db, skuId);
  const facts: Record<string, CanonicalFact> = {};
  for (const field of evidenceFieldOptions(type)) {
    const fact = fields.get(field.key);
    if (!isPublicCanonicalField(field.key) || fact?.status !== "VERIFIED" || fact.value === null
      || (typeof fact.value === "string" && !isPublicCanonicalText(fact.value))) continue;
    const definition = type?.attributeSchemaJson.find((entry) => entry.key === field.key);
    const fallback = field.key.replaceAll("_", " ");
    const [labelKa, labelEn] = factLabels[field.key] ?? [fallback, fallback];
    facts[field.key] = { value: fact.value, labelKa: definition?.labelKa ?? labelKa, labelEn: definition?.labelEn ?? labelEn, unit: field.unit };
  }
  return {
    identityKind: sku.identityKind, typeNameKa: type?.nameKa ?? "", typeNameEn: type?.nameEn ?? "",
    typeAliases: [...(type?.searchAliasesKa ?? []), ...(type?.searchAliasesEn ?? [])].filter(isPublicCanonicalText),
    distinguishing: type?.distinguishingAttributes ?? [], facts
  };
}

export async function recordCanonicalVersion(ctx: DomainTransactionContext, input: {
  skuId: string; locale: string; origin: CanonicalContentOrigin; draft: CanonicalDraft; authorId?: string; aiJobId?: string;
}) {
  await lockIdentityCatalog(ctx.tx);
  const parsed = contentDraft.safeParse(input.draft);
  if (!contentLocale.safeParse(input.locale).success || !parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid canonical content.");
  const [sku] = await ctx.tx.select({ state: skus.lifecycleState }).from(skus).where(eq(skus.id, input.skuId));
  if (!sku || sku.state === "ARCHIVED") throw new AppError("PRECONDITION_FAILED", "Only active SKUs can have new content.");
  const context = await getCanonicalContentContext(ctx.tx, input.skuId);
  const { issues, facts } = validateCanonicalDraft(parsed.data, context, input.locale);
  const [version] = await ctx.tx.insert(skuContentVersions).values({
    ...parsed.data, id: createUuidV7(), skuId: input.skuId, locale: input.locale,
    origin: input.origin, authorId: input.authorId, aiJobId: input.aiJobId, verifiedFacts: facts
  }).returning();
  await ctx.recordAudit({ action: "CANONICAL_CONTENT_VERSION_CREATED", entityType: "sku", entityId: input.skuId,
    after: { versionId: version!.id, locale: input.locale, origin: input.origin, facts } });
  await ctx.emitOutboxEvent({ eventType: "PRODUCT_UPDATED", aggregateType: "sku", aggregateId: input.skuId,
    payload: { contentVersionId: version!.id, locale: input.locale, approved: false }, consumers: [] });
  return { version: version!, issues };
}

export async function saveCanonicalVersion(db: DbExecutor, actor: DomainActor, raw: unknown) {
  const parsed = versionRequest.safeParse(raw);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid canonical content.");
  const { skuId, locale, draft } = parsed.data;
  return withDomainTransaction(db, actor, async (ctx) => {
    await lockIdentityCatalog(ctx.tx);
    const authorId = await assertContentAdmin(ctx, actor);
    const content = draft ?? generateCanonicalDraft(await getCanonicalContentContext(ctx.tx, skuId), locale);
    return recordCanonicalVersion(ctx, { skuId, locale, origin: draft ? "MANUAL" : "DETERMINISTIC", draft: content, authorId });
  });
}

export async function requireCurrentValidCanonicalContent(db: DbExecutor, skuId: string, locale: string) {
  const approved = (await getApprovedContent(db, skuId)).find(({ version }) => version.locale === locale)?.version;
  if (!approved) throw new AppError("PRECONDITION_FAILED", `Approved ${locale.toUpperCase()} canonical content is required.`);
  await validateApproval(db, approved);
  return approved;
}

async function validateApproval(db: DbExecutor, version: typeof skuContentVersions.$inferSelect) {
  const context = await getCanonicalContentContext(db, version.skuId);
  const { issues, facts } = validateCanonicalDraft(version, context, version.locale);
  if (issues.length) throw new AppError("VALIDATION_ERROR", "Canonical content contains unsupported readings.", { issues });
  const matches = Object.keys(facts).length === Object.keys(version.verifiedFacts).length
    && Object.entries(facts).every(([name, value]) => version.verifiedFacts[name] === value);
  if (!matches || version.imported) throw new AppError("PRECONDITION_FAILED", "Save a new version using the current verified facts.");
}

export async function approveCanonicalVersion(db: DbExecutor, actor: DomainActor, raw: unknown) {
  const parsed = approvalRequest.safeParse(raw);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "SKU and content version are required.");
  const { skuId, versionId } = parsed.data;
  return withDomainTransaction(db, actor, async (ctx) => {
    await lockIdentityCatalog(ctx.tx);
    const approvedBy = await assertContentAdmin(ctx, actor);
    const [sku] = await ctx.tx.select({ state: skus.lifecycleState }).from(skus).where(eq(skus.id, skuId));
    if (!sku || sku.state === "ARCHIVED") throw new AppError("PRECONDITION_FAILED", "Only active SKUs can have approved content.");
    const [version] = await ctx.tx.select().from(skuContentVersions)
      .where(and(eq(skuContentVersions.id, versionId), eq(skuContentVersions.skuId, skuId)));
    if (!version) throw new AppError("NOT_FOUND", "Content version not found.");
    await validateApproval(ctx.tx, version);
    const [previous] = await ctx.tx.select().from(skuContentApprovals)
      .where(and(eq(skuContentApprovals.skuId, skuId), eq(skuContentApprovals.locale, version.locale)));
    if (previous?.versionId === version.id) return version;
    const approval = { skuId, locale: version.locale, versionId, approvedBy, approvedAt: new Date() };
    await ctx.tx.insert(skuContentApprovals).values(approval).onConflictDoUpdate({
      target: [skuContentApprovals.skuId, skuContentApprovals.locale], set: approval
    });
    if (version.locale === "ka" || version.locale === "en") {
      const updates = version.locale === "ka"
        ? { displayNameKa: version.displayName, shortDescriptionKa: version.shortDescription,
          fullDescriptionKa: version.fullDescription, searchAliasesKa: version.searchAliases }
        : { displayNameEn: version.displayName, shortDescriptionEn: version.shortDescription,
          fullDescriptionEn: version.fullDescription, searchAliasesEn: version.searchAliases };
      await ctx.tx.update(skus).set({ ...updates, updatedAt: new Date() }).where(eq(skus.id, skuId));
    }
    await ctx.recordAudit({ action: "CANONICAL_CONTENT_APPROVED", entityType: "sku", entityId: skuId,
      before: previous ? { versionId: previous.versionId, locale: version.locale } : undefined,
      after: { versionId, locale: version.locale, approvedBy } });
    await ctx.emitOutboxEvent({ eventType: "PRODUCT_UPDATED", aggregateType: "sku", aggregateId: skuId,
      payload: { contentVersionId: versionId, locale: version.locale, approved: true }, consumers: [] });
    await refreshSkuContentReview(ctx, skuId);
    return version;
  });
}

export async function getCanonicalContentReview(db: DbExecutor, skuId: string) {
  const [versions, approved, fields, context] = await Promise.all([
    db.select().from(skuContentVersions).where(eq(skuContentVersions.skuId, skuId))
      .orderBy(desc(skuContentVersions.createdAt), desc(skuContentVersions.id)),
    getApprovedContent(db, skuId), getContentFactFields(db, skuId), getCanonicalContentContext(db, skuId)
  ]);
  return {
    versions: versions.map((version) => ({ ...version, issues: validateCanonicalDraft(version, context, version.locale).issues })),
    approved: approved.map(({ version, approvedAt }) => ({ id: version.id, locale: version.locale, approvedAt,
      ...compareApprovedContentFacts(version.verifiedFacts, fields) })),
    facts: context.facts
  };
}

export { generateCanonicalDraft, isPublicCanonicalField, isPublicCanonicalText, validateCanonicalDraft };
export type { CanonicalContentContext, CanonicalDraft, ContentIssue } from "./content-validation.ts";
