import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { legalEntities, skus, storefronts, type DbExecutor } from "@khidi/db";
import { AppError } from "@khidi/shared";
import { type DomainActor, withDomainTransaction } from "@khidi/domain";
import { assertPriceAccess, commitPriceChanges, listLatestPrices, previewPriceChanges, type PriceChange } from "./index.ts";
import { parsePriceInput, priceInputValue } from "./format.ts";

export const PRICE_CSV_COLUMNS = ["storefront_key", "internal_sku", "display_name_ka", "amount_gel", "vat_included", "last_changed_at"] as const;
export type CsvPriceError = "INVALID_CSV" | "INVALID_HEADER" | "INVALID_AMOUNT" | "INVALID_VAT" | "UNKNOWN_SKU" | "UNKNOWN_STOREFRONT" | "DUPLICATE_ROW" | "VAT_OVERRIDE_FORBIDDEN" | "ARCHIVED_SKU";
const exportSchema = z.object({ mode: z.enum(["current", "template"]).default("current"), lifecycle: z.enum([
  "INTAKE", "IDENTIFYING", "IDENTIFICATION_REQUIRED", "IDENTIFIED", "ACCOUNTING_MAPPING_REQUIRED", "CONTENT_GENERATING", "CONTENT_REVIEW", "READY", "ARCHIVED"
]).optional() }).strict();
export type PriceCsvExportOptions = z.input<typeof exportSchema>;

/** RFC-style quoting, including doubled quotes and multiline display names. */
export function parsePriceCsv(raw: string): { records: string[][]; error?: CsvPriceError } {
  if (Buffer.byteLength(raw, "utf8") > 2_000_000) return { records: [], error: "INVALID_CSV" };
  const text = raw.replace(/^\uFEFF/, "");
  const separator = text.slice(0, text.search(/[\r\n]/) < 0 ? text.length : text.search(/[\r\n]/)).includes(";") ? ";" : ",";
  const records: string[][] = [];
  let row: string[] = [], cell = "", quoted = false, closed = false;
  const finishCell = () => { row.push(cell); cell = ""; closed = false; };
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { cell += '"'; index++; }
      else if (char === '"') { quoted = false; closed = true; }
      else cell += char;
    } else if (char === separator) finishCell();
    else if (char === "\n" || char === "\r") {
      finishCell(); records.push(row); row = [];
      if (char === "\r" && text[index + 1] === "\n") index++;
    } else if (char === '"' && !cell && !closed) quoted = true;
    else if (char === '"' || closed) return { records: [], error: "INVALID_CSV" };
    else cell += char;
    if (records.length > 1001) return { records: [], error: "INVALID_CSV" };
  }
  if (quoted) return { records: [], error: "INVALID_CSV" };
  if (cell || row.length || closed) { finishCell(); records.push(row); }
  if (records[0]?.length !== PRICE_CSV_COLUMNS.length || PRICE_CSV_COLUMNS.some((name, index) => records[0]?.[index] !== name)) return { records: [], error: "INVALID_HEADER" };
  if (records.length < 2 || records.length > 1001) return { records: [], error: "INVALID_CSV" };
  return { records };
}
function csvCell(value: string) {
  const safe = /^[\s]*[=+@-]/.test(value) ? "'" + value : value;
  return /[",\r\n]/.test(safe) ? '"' + safe.replaceAll('"', '""') + '"' : safe;
}

export async function exportPricesCsv(db: DbExecutor, actor: DomainActor, storefrontId: string, rawOptions: PriceCsvExportOptions = {}) {
  await assertPriceAccess(db, actor);
  const options = exportSchema.safeParse(rawOptions);
  if (!options.success) throw new AppError("VALIDATION_ERROR", "Invalid CSV export filter.");
  const [target] = await db.select({ store: storefronts, vat: legalEntities.pricesIncludeVat }).from(storefronts)
    .innerJoin(legalEntities, eq(legalEntities.id, storefronts.sellerEntityId)).where(eq(storefronts.id, storefrontId));
  if (!target) throw new AppError("NOT_FOUND", "Storefront not found.");
  const latest = await listLatestPrices(db, { storefrontId });
  const bySku = new Map(latest.map((row) => [row.skuId, row]));
  const products = await db.select({ id: skus.id, code: skus.internalSku, name: skus.displayNameKa }).from(skus)
    .where(and(ne(skus.lifecycleState, "ARCHIVED"), options.data.lifecycle ? eq(skus.lifecycleState, options.data.lifecycle) : undefined,
      options.data.mode === "current" ? inArray(skus.id, latest.filter((row) => row.kind === "SET").map((row) => row.skuId)) : undefined)).orderBy(asc(skus.internalSku));
  return "\uFEFF" + [PRICE_CSV_COLUMNS.join(","), ...products.map((product) => {
    const price = bySku.get(product.id);
    return [target.store.key, product.code, product.name ?? "", price?.kind === "SET" ? priceInputValue(price.basePriceMinor!) : "",
      String(price?.vatIncluded ?? target.vat), price?.setAt.toISOString() ?? ""].map(csvCell).join(",");
  })].join("\r\n") + "\r\n";
}

const csvInputSchema = z.object({ storefrontId: z.string().uuid(), csv: z.string().max(2_000_000), excludedRows: z.array(z.number().int().min(2)).max(1000).default([]) }).strict();
export type CsvPriceInput = z.input<typeof csvInputSchema>;
export async function previewCsvImport(db: DbExecutor, actor: DomainActor, raw: CsvPriceInput) {
  const user = await assertPriceAccess(db, actor, true);
  const parsed = csvInputSchema.safeParse(raw);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid CSV request.");
  const input = parsed.data, document = parsePriceCsv(input.csv);
  if (document.error) return { rows: [], preview: [], errors: [document.error], canCommit: false };
  const excluded = new Set(input.excludedRows);
  if ([...excluded].some((row) => row > document.records.length)) throw new AppError("VALIDATION_ERROR", "Invalid excluded row.");
  const [target] = await db.select({ store: storefronts, vat: legalEntities.pricesIncludeVat }).from(storefronts)
    .innerJoin(legalEntities, eq(legalEntities.id, storefronts.sellerEntityId)).where(eq(storefronts.id, input.storefrontId));
  if (!target) throw new AppError("NOT_FOUND", "Storefront not found.");
  const codes = document.records.slice(1).map((row) => row[1]?.trim() ?? "");
  const products = codes.length ? await db.select({ id: skus.id, code: skus.internalSku, state: skus.lifecycleState }).from(skus).where(inArray(skus.internalSku, codes)) : [];
  const byCode = new Map(products.map((row) => [row.code, row.id]));
  const latest = new Map((await listLatestPrices(db, { storefrontId: input.storefrontId })).map((row) => [row.skuId, row]));
  const counts = new Map<string, number>();
  codes.forEach((code, index) => { if (!excluded.has(index + 2)) counts.set(code, (counts.get(code) ?? 0) + 1); });
  const rows = document.records.slice(1).map((record, index) => {
    const rowNumber = index + 2, internalSku = record[1]?.trim() ?? "";
    const errors: CsvPriceError[] = [];
    const unchanged = !(record[3] ?? "").trim();
    const amount = unchanged ? null : parsePriceInput(record[3] ?? ""), vat = record[4]?.trim().toLowerCase();
    if (record.length !== PRICE_CSV_COLUMNS.length) errors.push("INVALID_CSV");
    if (record[0]?.trim() !== target.store.key) errors.push("UNKNOWN_STOREFRONT");
    if (!byCode.has(internalSku)) errors.push("UNKNOWN_SKU");
    if (!unchanged && products.find((row) => row.code === internalSku)?.state === "ARCHIVED") errors.push("ARCHIVED_SKU");
    if (!unchanged && amount === null) errors.push("INVALID_AMOUNT");
    if (!unchanged && vat !== "true" && vat !== "false") errors.push("INVALID_VAT");
    const defaultVat = latest.get(byCode.get(internalSku) ?? "")?.vatIncluded ?? target.vat;
    if (!unchanged && user.role !== "ADMIN" && (vat === "true" || vat === "false") && (vat === "true") !== defaultVat) errors.push("VAT_OVERRIDE_FORBIDDEN");
    if ((counts.get(internalSku) ?? 0) > 1) errors.push("DUPLICATE_ROW");
    return { rowNumber, internalSku, errors, unchanged, excluded: excluded.has(rowNumber), change: errors.length || unchanged ? null : {
      skuId: byCode.get(internalSku)!, storefrontId: input.storefrontId, basePriceMinor: amount!, vatIncluded: vat === "true",
      expectedPriceId: latest.get(byCode.get(internalSku)!)?.id ?? null
    } satisfies PriceChange };
  });
  const changes = rows.flatMap((row) => !row.excluded && row.change ? [row.change] : []);
  const preview = changes.length ? await previewPriceChanges(db, actor, { changes, source: "CSV_IMPORT" }) : [];
  return { rows, preview, errors: [] as CsvPriceError[], canCommit: rows.some((row) => !row.excluded) && rows.every((row) => row.excluded || !row.errors.length) };
}
export async function commitCsvImport(db: DbExecutor, actor: DomainActor, input: CsvPriceInput & {
  expectedPriceIds: Record<string, string | null>; reason?: string; confirmLargeChanges?: boolean;
}) {
  return withDomainTransaction(db, actor, async (ctx) => {
    const { expectedPriceIds, reason, confirmLargeChanges, ...csvInput } = input;
    const result = await previewCsvImport(ctx.tx, actor, csvInput);
    if (!result.canCommit) throw new AppError("VALIDATION_ERROR", "Fix or explicitly exclude CSV errors before committing.");
    if (!result.preview.length) return { batchId: null, rows: [] };
    const ids = z.record(z.string().uuid().nullable()).safeParse(expectedPriceIds);
    if (!ids.success || result.preview.some((row) => !(row.skuId in ids.data))) throw new AppError("VALIDATION_ERROR", "CSV preview required.");
    return commitPriceChanges(ctx.tx, actor, { source: "CSV_IMPORT", reason, confirmLargeChanges,
      changes: result.preview.map(({ skuId, storefrontId, basePriceMinor, vatIncluded }) => ({ skuId, storefrontId, basePriceMinor,
        vatIncluded, expectedPriceId: ids.data[skuId]! })) });
  });
}
