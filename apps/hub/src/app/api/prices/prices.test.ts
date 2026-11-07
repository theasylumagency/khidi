import { expect, it, vi } from "vitest";
import { getDb, users } from "@khidi/db";
import { loadPrincipalByUserId, webauthnConfig, type AuthenticatedPrincipal } from "@khidi/auth";
import { createSkuDraft } from "@khidi/products";
import { createUuidV7 } from "@khidi/shared";
import { GET, POST } from "./route.ts";
import { GET as exportCsv, POST as importCsv } from "./csv/route.ts";

const session = vi.hoisted(() => ({ principal: null as AuthenticatedPrincipal | null }));
vi.mock("../../../lib/session.ts", () => ({ getCurrentPrincipal: async () => session.principal }));
it("requires an authenticated price permission, previews without writes and replays the confirmed batch", async () => {
  const db = getDb(), origin = webauthnConfig().origin;
  const admin = (await db.query.users.findFirst({ where: (row, { eq }) => eq(row.role, "ADMIN") }))!;
  const store = (await db.query.storefronts.findFirst())!;
  const sku = await createSkuDraft(db, { userId: admin.id }, {});
  const request = (body: unknown, key?: string) => new Request(origin + "/api/prices", { method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) }, body: JSON.stringify(body) });
  session.principal = null;
  expect((await GET(new Request(origin + "/api/prices"))).status).toBe(401);
  const principal = await loadPrincipalByUserId(db, admin.id);
  for (const role of ["WAREHOUSE", "OPERATOR"] as const) {
    const [user] = await db.insert(users).values({ id: createUuidV7(), fullName: "Price route fixture", role }).returning();
    session.principal = { ...principal, userId: user!.id, role, permissions: role === "WAREHOUSE" ? ["price.edit"] : [] };
    const response = await POST(request({ action: "preview", batch: { changes: [{ skuId: sku.id, storefrontId: store.id, basePriceMinor: 100 }] } }));
    expect(response.status).toBe(403);
    if (role === "WAREHOUSE") {
      const denied = await GET(new Request(origin + `/api/prices?skuId=${sku.id}`));
      expect(denied.status).toBe(403);
      expect(await denied.text()).not.toMatch(/basePriceMinor|vatIncluded|setBy|rows/);
      expect((await exportCsv(new Request(origin + `/api/prices/csv?storefrontId=${store.id}`))).status).toBe(403);
      expect((await importCsv(request({ action: "preview", input: { storefrontId: store.id, csv: "private" } }))).status).toBe(403);
    }
  }
  session.principal = principal;
  const batch = { source: "BULK", changes: [{ skuId: sku.id, storefrontId: store.id, basePriceMinor: 10000 }] };
  const response = await POST(request({ action: "preview", batch }));
  expect(response.status).toBe(200);
  const { preview } = await response.json();
  expect((await (await GET(new Request(origin + `/api/prices?skuId=${sku.id}`))).json()).rows).toHaveLength(0);
  const changes = preview.map(({ skuId, storefrontId, basePriceMinor, expectedPriceId }: { skuId: string; storefrontId: string; basePriceMinor: number; expectedPriceId: string | null }) => ({ skuId, storefrontId, basePriceMinor, expectedPriceId }));
  const key = createUuidV7();
  const commit = () => POST(request({ action: "commit", batch: { ...batch, changes } }, key));
  const first = await commit();
  expect(first.status).toBe(201);
  expect(await (await commit()).json()).toEqual(await first.json());
  expect((await (await GET(new Request(origin + `/api/prices?skuId=${sku.id}`))).json()).rows).toHaveLength(1);
  expect((await POST(new Request(origin + "/api/prices", { method: "POST", headers: { Origin: "https://wrong.invalid" } }))).status).toBe(403);
});

it("previews CSV errors before allowing an explicitly filtered idempotent import and BOM export", async () => {
  const db = getDb(), origin = webauthnConfig().origin;
  const admin = (await db.query.users.findFirst({ where: (row, { eq }) => eq(row.role, "ADMIN") }))!;
  const store = (await db.query.storefronts.findFirst())!;
  session.principal = await loadPrincipalByUserId(db, admin.id);
  const sku = await createSkuDraft(db, { userId: admin.id }, {});
  const csv = `storefront_key,internal_sku,display_name_ka,amount_gel,vat_included,last_changed_at\n${store.key},${sku.internalSku},სახელი,12.50,true,ignored\n${store.key},KH-99999999,სახელი,10,true,ignored`;
  const input = { storefrontId: store.id, csv, excludedRows: [] as number[] };
  const send = (body: unknown, key?: string) => importCsv(new Request(origin + "/api/prices/csv", { method: "POST", headers: {
    Origin: origin, "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) }, body: JSON.stringify(body) }));
  expect((await (await send({ action: "preview", input })).json()).canCommit).toBe(false);
  expect((await send({ action: "commit", input, expectedPriceIds: { [sku.id]: null } }, createUuidV7())).status).toBe(400);
  input.excludedRows = [3];
  const preview = await (await send({ action: "preview", input })).json();
  expect(preview.canCommit).toBe(true);
  const key = createUuidV7(), body = { action: "commit", input, expectedPriceIds: { [sku.id]: preview.preview[0].expectedPriceId } };
  const first = await send(body, key);
  expect(first.status).toBe(201);
  expect(await (await send(body, key)).json()).toEqual(await first.json());
  const exported = await exportCsv(new Request(origin + `/api/prices/csv?storefrontId=${store.id}`));
  expect(exported.status).toBe(200);
  expect(exported.headers.get("Content-Type")).toContain("text/csv");
  expect(exported.headers.get("Cache-Control")).toContain("no-store");
  const bytes = new Uint8Array(await exported.arrayBuffer());
  expect([...bytes.slice(0, 3)]).toEqual([239, 187, 191]);
  expect(new TextDecoder().decode(bytes)).toContain(`${store.key},${sku.internalSku}`);
});
