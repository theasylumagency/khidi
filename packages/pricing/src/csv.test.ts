import { expect, it } from "vitest";
import { getDb, skus } from "@khidi/db";
import { eq } from "drizzle-orm";
import { executeIdempotent } from "@khidi/domain";
import { createSkuDraft, transitionSkuLifecycle } from "@khidi/products";
import { createUuidV7 } from "@khidi/shared";
import { getCurrentPrice, getPriceHistory, setPrice } from "./index.ts";
import { commitCsvImport, exportPricesCsv, parsePriceCsv, previewCsvImport, PRICE_CSV_COLUMNS } from "./csv.ts";

const db = getDb(), header = PRICE_CSV_COLUMNS.join(",");
async function fixture() {
  const admin = (await db.query.users.findFirst({ where: (row, { eq }) => eq(row.role, "ADMIN") }))!;
  const store = (await db.query.storefronts.findFirst())!;
  const actor = { userId: admin.id };
  const a = await createSkuDraft(db, actor, {}), b = await createSkuDraft(db, actor, {});
  const csv = (rows: string[]) => header + "\r\n" + rows.join("\r\n") + "\r\n";
  const row = (code: string, amount: string, storeKey = store.key) => `${storeKey},${code},ქართული პროდუქტი,${amount},true,ignored`;
  return { actor, store, a, b, csv, row };
}
it("parses BOM, quoted decimal commas, semicolon decimal commas, and strict quoting/headers", () => {
  const line = 'store-a,KH-000001,"ქართული, სახელი","1234,50",true,ignored';
  expect(parsePriceCsv("\uFEFF" + header + "\r\n" + line).records[1]?.[3]).toBe("1234,50");
  expect(parsePriceCsv(header.replaceAll(",", ";") + "\nstore-a;KH-000001;სახელი;1234,50;false;ignored").records[1]?.[3]).toBe("1234,50");
  expect(parsePriceCsv(header + '\n"unclosed').error).toBe("INVALID_CSV");
  expect(parsePriceCsv(header + '\n"closed"x,KH-000001,name,1,true,date').error).toBe("INVALID_CSV");
  expect(parsePriceCsv("wrong\n" + line).error).toBe("INVALID_HEADER");
  expect(parsePriceCsv('"' + header + '"\n' + line).error).toBe("INVALID_HEADER");
});
it("exports only current prices with a UTF-8 BOM and unchanged stored storefront keys", async () => {
  const f = await fixture();
  await setPrice(db, f.actor, { skuId: f.a.id, storefrontId: f.store.id, basePriceMinor: 123450 });
  const csv = await exportPricesCsv(db, f.actor, f.store.id);
  expect([...Buffer.from(csv).subarray(0, 3)]).toEqual([239, 187, 191]);
  const row = parsePriceCsv(csv).records.find((row) => row[1] === f.a.internalSku)!;
  expect(row[0]).toBe(f.store.key);
  expect(row[3]).toBe("1234.50");
});
it("reports amount, VAT, unknown SKU/store and duplicate errors, and supports explicit row exclusions", async () => {
  const f = await fixture();
  for (const amount of ['"1,234.50"', '"1.234,50"', "1.234", "0", "-5"]) {
    const result = await previewCsvImport(db, f.actor, { storefrontId: f.store.id, csv: f.csv([f.row(f.a.internalSku, amount)]) });
    expect(result.rows[0]?.errors).toContain("INVALID_AMOUNT");
  }
  const input = { storefrontId: f.store.id, csv: f.csv([f.row(f.a.internalSku, '"1234,50"'), f.row("KH-99999999", "1"), f.row(f.b.internalSku, "2", "missing-store")]) };
  const initial = await previewCsvImport(db, f.actor, input);
  expect(initial.rows[1]?.errors).toContain("UNKNOWN_SKU");
  expect(initial.rows[2]?.errors).toContain("UNKNOWN_STOREFRONT");
  expect(initial.canCommit).toBe(false);
  expect(await getCurrentPrice(db, f.a.id, f.store.id)).toBeNull();
  const excluded = await previewCsvImport(db, f.actor, { ...input, excludedRows: [3, 4] });
  expect(excluded.canCommit).toBe(true);
  expect(excluded.preview).toHaveLength(1);
  const duplicates = { storefrontId: f.store.id, csv: f.csv([f.row(f.a.internalSku, "1"), f.row(f.a.internalSku, "2")]) };
  expect((await previewCsvImport(db, f.actor, duplicates)).rows.every((row) => row.errors.includes("DUPLICATE_ROW"))).toBe(true);
  expect((await previewCsvImport(db, f.actor, { ...duplicates, excludedRows: [3] })).canCommit).toBe(true);
  expect((await previewCsvImport(db, f.actor, { ...input, csv: f.csv([f.row(f.a.internalSku, "1").replace(",true,", ",maybe,")]) })).rows[0]?.errors).toContain("INVALID_VAT");
});
it("rejects a file with errors, then commits only explicitly included rows atomically and idempotently", async () => {
  const f = await fixture();
  const input = { storefrontId: f.store.id, csv: f.csv([f.row(f.a.internalSku, "100.00"), f.row("KH-99999999", "5")]) };
  await expect(commitCsvImport(db, f.actor, { ...input, expectedPriceIds: { [f.a.id]: null } })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  expect(await getCurrentPrice(db, f.a.id, f.store.id)).toBeNull();
  const confirmed = { ...input, excludedRows: [3], expectedPriceIds: { [f.a.id]: null } };
  const key = createUuidV7();
  const commit = () => executeIdempotent(db, { scope: "csv-test", idempotencyKey: key, payload: confirmed }, async (tx) => ({
    status: 201, body: await commitCsvImport(tx, f.actor, confirmed)
  }));
  const first = await commit();
  expect(first.body.rows).toMatchObject([{ source: "CSV_IMPORT", basePriceMinor: 10000 }]);
  expect(first.body.batchId).toBeTruthy();
  expect((await commit()).body).toEqual(JSON.parse(JSON.stringify(first.body)));
});
it("requires a batch reason for CSV large changes and rolls back the whole batch on a stale row", async () => {
  const f = await fixture();
  for (const sku of [f.a, f.b]) await setPrice(db, f.actor, { skuId: sku.id, storefrontId: f.store.id, basePriceMinor: 10000 });
  const input = { storefrontId: f.store.id, csv: f.csv([f.row(f.a.internalSku, "130"), f.row(f.b.internalSku, "110")]) };
  const preview = await previewCsvImport(db, f.actor, input);
  expect(preview.preview.map((row) => row.largeChange)).toEqual([true, false]);
  const expectedPriceIds = Object.fromEntries(preview.preview.map((row) => [row.skuId, row.expectedPriceId]));
  await expect(commitCsvImport(db, f.actor, { ...input, expectedPriceIds })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  await expect(commitCsvImport(db, f.actor, { ...input, expectedPriceIds: { ...expectedPriceIds, [f.b.id]: null }, confirmLargeChanges: true, reason: "Approved batch" })).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await getCurrentPrice(db, f.a.id, f.store.id)).toMatchObject({ basePriceMinor: 10000 });
  const result = await commitCsvImport(db, f.actor, { ...input, expectedPriceIds, confirmLargeChanges: true, reason: "Approved batch" });
  expect(result.rows).toHaveLength(2);
  expect(result.rows.every((row) => row.batchId === result.batchId)).toBe(true);
});

it("exports unpriced non-archived SKUs in templates and applies lifecycle filters", async () => {
  const f = await fixture();
  await transitionSkuLifecycle(db, f.actor, f.b.id, "ARCHIVED", { reason: "Template exclusion fixture" });
  const template = parsePriceCsv(await exportPricesCsv(db, f.actor, f.store.id, { mode: "template" }));
  expect(template.records.find((row) => row[1] === f.a.internalSku)?.[3]).toBe("");
  expect(template.records.find((row) => row[1] === f.b.internalSku)).toBeUndefined();
  const slug = "csv-ready-" + createUuidV7();
  await db.update(skus).set({ lifecycleState: "READY", canonicalSlug: slug, reverificationRequired: true }).where(eq(skus.id, f.a.id));
  const ready = parsePriceCsv(await exportPricesCsv(db, f.actor, f.store.id, { mode: "template", lifecycle: "READY" }));
  expect(ready.records.some((row) => row[1] === f.a.internalSku)).toBe(true);
  const intake = parsePriceCsv(await exportPricesCsv(db, f.actor, f.store.id, { mode: "template", lifecycle: "INTAKE" }));
  expect(intake.records.some((row) => row[1] === f.a.internalSku)).toBe(false);
});

it("treats empty amounts as unchanged and never withdraws or changes VAT", async () => {
  const f = await fixture();
  await setPrice(db, f.actor, { skuId: f.a.id, storefrontId: f.store.id, basePriceMinor: 10000, vatIncluded: false });
  const before = await getPriceHistory(db, f.actor, f.a.id);
  const input = { storefrontId: f.store.id, csv: f.csv([f.row(f.a.internalSku, ""), f.row(f.b.internalSku, "")]) };
  const preview = await previewCsvImport(db, f.actor, input);
  expect(preview.rows.every((row) => row.unchanged && !row.errors.length)).toBe(true);
  expect(preview.preview).toEqual([]);
  expect(await commitCsvImport(db, f.actor, { ...input, expectedPriceIds: {} })).toEqual({ batchId: null, rows: [] });
  expect(await getPriceHistory(db, f.actor, f.a.id)).toEqual(before);
  expect(await getCurrentPrice(db, f.b.id, f.store.id)).toBeNull();
});

it("creates first prices from filled template amounts and retains blank template rows", async () => {
  const f = await fixture();
  const template = parsePriceCsv(await exportPricesCsv(db, f.actor, f.store.id, { mode: "template" }));
  const rows = template.records.slice(1).filter((row) => row[1] === f.a.internalSku || row[1] === f.b.internalSku);
  rows.find((row) => row[1] === f.a.internalSku)![3] = "45.50";
  const input = { storefrontId: f.store.id, csv: f.csv(rows.map((row) => row.join(","))) };
  const preview = await previewCsvImport(db, f.actor, input);
  expect(preview.preview).toHaveLength(1);
  const expectedPriceIds = Object.fromEntries(preview.preview.map((row) => [row.skuId, row.expectedPriceId]));
  const result = await commitCsvImport(db, f.actor, { ...input, expectedPriceIds });
  expect(result.rows).toMatchObject([{ skuId: f.a.id, basePriceMinor: 4550, source: "CSV_IMPORT" }]);
  expect(await getCurrentPrice(db, f.b.id, f.store.id)).toBeNull();
});
