import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { systemSettings, users, type DbExecutor } from "@khidi/db";
import { withDomainTransaction, type DomainActor } from "@khidi/domain";
import { lockIdentityCatalog } from "@khidi/evidence";
import { AppError } from "@khidi/shared";

export const technicalTerms = {
  hp: { fields: ["power_kw"], unit: "HP", defaults: ["ცხ.ძ.", "ცხ.ძ", "ცხენიანი", "ცხენიანია", "ცხენის ძალა"] },
  kw: { fields: ["power_kw"], unit: "kW", defaults: ["კვტ", "კილოვატი"] },
  w: { fields: ["power_kw"], unit: "W", defaults: ["ვტ", "ვატი"] },
  kg: { fields: ["weight_kg"], unit: "kg", defaults: ["კგ", "კილოგრამი"] },
  mm: { fields: ["length_mm", "width_mm", "height_mm", "working_width_mm", "working_depth_mm"], unit: "mm", defaults: ["მმ", "მილიმეტრი"] },
  cm3: { fields: ["engine_displacement_cm3"], unit: "cm³", defaults: ["სმ³", "cc"] },
  litre: { fields: ["volume_l"], unit: "L", defaults: ["ლ", "ლიტრი"] },
  bar: { fields: ["pressure_bar"], unit: "bar", defaults: ["ბარი", "ბარ"] },
  flow: { fields: ["flow_l_min"], unit: "L/min", defaults: ["ლ/წთ"] },
  volt: { fields: ["voltage_v"], unit: "V", defaults: ["ვოლტი"] },
  amp: { fields: ["current_a"], unit: "A", defaults: ["ამპერი"] },
  gears: { fields: ["transmission_gears"], unit: "", defaults: ["სიჩქარიანი", "სიჩქარიანია", "სიჩქარე", "გადაცემა", "gears", "speed"] }
} satisfies Record<string, { fields: string[]; unit: string; defaults: string[] }>;

type TermGroup = keyof typeof technicalTerms;
export type TechnicalSynonyms = Partial<Record<TermGroup, string[]>>;
const groupNames = Object.keys(technicalTerms) as [TermGroup, ...TermGroup[]];
const settingsKey = "canonical_content_technical_synonyms";
const synonymsSchema = z.record(z.enum(groupNames), z.array(z.string().trim().min(1).max(60)
  .regex(/^[\p{L}\p{M}\p{N} ./-]*\p{L}[\p{L}\p{M}\p{N} ./-]*$/u)).max(30));

export function normalizeContentText(text: string) {
  return text.normalize("NFKC").replace(/[\u2010-\u2015\u2212]/g, "-").replace(/[^\S\r\n]+/g, " ");
}

export async function getTechnicalSynonyms(db: DbExecutor): Promise<TechnicalSynonyms> {
  const [setting] = await db.select({ value: systemSettings.valueJson }).from(systemSettings).where(eq(systemSettings.key, settingsKey));
  return synonymsSchema.parse(setting?.value ?? {});
}

export function listTechnicalTermGroups(synonyms: TechnicalSynonyms) {
  return groupNames.map((group) => ({
    group, ...technicalTerms[group], aliases: synonyms[group] ?? technicalTerms[group].defaults
  }));
}

export async function saveTechnicalSynonyms(db: DbExecutor, actor: DomainActor, raw: unknown) {
  const parsed = synonymsSchema.safeParse(raw);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid technical synonyms.");
  const terms = new Map<string, TermGroup>();
  for (const { group, unit, aliases } of listTechnicalTermGroups(parsed.data)) {
    for (const alias of [unit, ...aliases].filter(Boolean)) {
      const key = normalizeContentText(alias).toLowerCase();
      const previous = terms.get(key);
      if (previous && previous !== group) throw new AppError("VALIDATION_ERROR", "A synonym must belong to only one group.");
      terms.set(key, group);
    }
  }
  return withDomainTransaction(db, actor, async (ctx) => {
    await lockIdentityCatalog(ctx.tx);
    const [admin] = actor.userId ? await ctx.tx.select({ id: users.id }).from(users)
      .where(and(eq(users.id, actor.userId), eq(users.active, true), eq(users.role, "ADMIN"))) : [];
    if (!admin) throw new AppError("FORBIDDEN", "Technical synonyms require an active admin.");
    const before = await getTechnicalSynonyms(ctx.tx);
    const updates = { valueJson: parsed.data, updatedBy: admin.id, updatedAt: new Date() };
    await ctx.tx.insert(systemSettings).values({ key: settingsKey, description: "Canonical content technical synonyms", ...updates })
      .onConflictDoUpdate({ target: systemSettings.key, set: updates });
    await ctx.recordAudit({ action: "CANONICAL_TECHNICAL_SYNONYMS_UPDATED", entityType: "system_setting", entityId: settingsKey,
      before, after: parsed.data });
    await ctx.emitOutboxEvent({ eventType: "PRODUCT_CONTENT_RULES_UPDATED", aggregateType: "user", aggregateId: admin.id,
      payload: { key: settingsKey }, consumers: [] });
    return { id: settingsKey };
  });
}
