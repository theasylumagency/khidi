import { expect, it, vi } from "vitest";
import { getDb, users } from "@khidi/db";
import { loadPrincipalByUserId, webauthnConfig, type AuthenticatedPrincipal } from "@khidi/auth";
import { createSkuDraft } from "@khidi/products";
import { createUuidV7 } from "@khidi/shared";
import { GET, POST } from "./route.ts";

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
