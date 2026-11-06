import { expect, it, vi } from "vitest";
import { loadPrincipalByUserId, webauthnConfig, type AuthenticatedPrincipal } from "@khidi/auth";
import { getDb } from "@khidi/db";
import { createSkuDraft, getProductTypeByKey } from "@khidi/products";
import { createUuidV7 } from "@khidi/shared";
import { POST as postEvidence } from "./route.ts";
import { POST as updateLifecycle } from "../products/ready/route.ts";

const { session } = vi.hoisted(() => ({ session: { principal: null as AuthenticatedPrincipal | null } }));
vi.mock("../../../lib/session.ts", () => ({ getCurrentPrincipal: async () => session.principal }));

it("accepts a multipart inspection and replays evidence and lifecycle requests by key", async () => {
  const db = getDb();
  const admin = await db.query.users.findFirst({ where: (user, { eq }) => eq(user.role, "ADMIN") });
  session.principal = await loadPrincipalByUserId(db, admin!.id);
  const actor = { userId: admin!.id };
  const type = await getProductTypeByKey(db, "MOTOBLOCK");
  const sku = await createSkuDraft(db, actor, { productTypeId: type.id });
  const origin = webauthnConfig().origin;
  const form = new FormData();
  const claims = { wheel_type: "RUBBER" };
  form.set("evidence", JSON.stringify({ action: "submit", skuId: sku.id, type: "ADMIN_PHYSICAL_INSPECTION", notes: "Observed rubber wheels", claims }));
  const submitKey = createUuidV7();
  const submit = () => postEvidence(new Request(`${origin}/api/evidence`, { method: "POST", headers: { Origin: origin, "Idempotency-Key": submitKey }, body: form }));
  const first = await submit();
  expect(first.status).toBe(201);
  const item = await first.json();
  expect(await (await submit()).json()).toEqual(item);
  const review = await postEvidence(new Request(`${origin}/api/evidence`, { method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json", "Idempotency-Key": createUuidV7() },
    body: JSON.stringify({ action: "review", evidenceId: item.id, status: "ACCEPTED", reason: "Confirmed physical inspection", claims }) }));
  expect(review.status).toBe(200);
  const lifecycleKey = createUuidV7();
  const move = () => updateLifecycle(new Request(`${origin}/api/products/ready`, { method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": lifecycleKey },
    body: JSON.stringify({ action: "TRANSITION_LIFECYCLE", skuId: sku.id, targetState: "IDENTIFIED" }) }));
  const moved = await move();
  expect(moved.status).toBe(200);
  const result = await moved.json();
  expect(result.sku.lifecycleState).toBe("IDENTIFIED");
  expect(await (await move()).json()).toEqual(result);
});
