import { and, eq, or } from "drizzle-orm";
import { accountingMappings, allocations, fulfillmentLines, fulfillmentRequests, reservationItems, reservationLines, reservations, stockPools,
  storefrontApiKeys, storefronts, unitConfirmations, type DbExecutor } from "@khidi/db";
import { createUuidV7 } from "@khidi/shared";
import type { StockMovement } from "./types.ts";

/** Genuine workflow rows for legacy primitive/model tests; never mocks the proof gate. */
export async function primitiveWorkflowFixture(tx: DbExecutor, userId: string, raw: readonly StockMovement[]) {
  const movements = raw.map((m)=>({...m}));
  for (const m of movements) {
    if (!m.reservationId || !m.allocationId) continue;
    const [a] = await tx.select().from(allocations).where(eq(allocations.id,m.allocationId));
    if (!a || a.skuId !== m.skuId || a.poolId !== m.poolId) continue;
    const [store] = await tx.select().from(storefronts).where(eq(storefronts.id,a.storefrontId));
    const [pool] = await tx.select().from(stockPools).where(eq(stockPools.id,a.poolId));
    let [header] = await tx.select().from(reservations).where(eq(reservations.id,m.reservationId));
    if (!header) {
      const [key] = await tx.insert(storefrontApiKeys).values({id:createUuidV7(),storefrontId:a.storefrontId,name:"Primitive fixture",keyPrefix:"fixture",keyHash:createUuidV7()}).returning();
      [header] = await tx.insert(reservations).values({id:m.reservationId,storefrontId:a.storefrontId,storefrontOrderRef:"fixture",paymentMethod:m.paymentMethod??"CARD",
        fulfillmentMode:"CONTROLLED_FULFILLMENT",createdByApiKeyId:key!.id,idempotencyKey:createUuidV7(),expiresAt:new Date(Date.now()+86400000)}).onConflictDoNothing().returning();
      if (!header) [header] = await tx.select().from(reservations).where(eq(reservations.id,m.reservationId));
    }
    let [line] = await tx.select().from(reservationLines).where(and(eq(reservationLines.reservationId,m.reservationId),eq(reservationLines.allocationId,m.allocationId)));
    if (!line) {
      const [otherLine] = await tx.select().from(reservationLines).where(eq(reservationLines.reservationId,m.reservationId));
      if (otherLine) continue; // Transfer primitives carry irrelevant legacy references.
      const mappings=[];
      for (const entityId of [store!.sellerEntityId,pool!.ownerEntityId]) {
        let [mapping] = await tx.select().from(accountingMappings).where(and(eq(accountingMappings.skuId,m.skuId),eq(accountingMappings.legalEntityId,entityId)));
        if (!mapping) [mapping] = await tx.insert(accountingMappings).values({id:createUuidV7(),skuId:m.skuId,legalEntityId:entityId,accountingItemId:"fixture",accountingName:"Primitive fixture",active:false}).returning();
        mappings.push(mapping!);
      }
      const [item] = await tx.insert(reservationItems).values({id:createUuidV7(),reservationId:m.reservationId,skuId:m.skuId,quantity:100000,composedBundle:false,basePriceMinor:0,currency:"GEL"}).returning();
      [line] = await tx.insert(reservationLines).values({id:createUuidV7(),reservationId:m.reservationId,itemId:item!.id,skuId:m.skuId,allocationId:m.allocationId,quantity:100000,
        sellerMappingId:mappings[0]!.id,sellerAccountingItemId:mappings[0]!.accountingItemId,sellerAccountingName:mappings[0]!.accountingName,
        ownerMappingId:mappings[1]!.id,ownerAccountingItemId:mappings[1]!.accountingItemId,ownerAccountingName:mappings[1]!.accountingName}).returning();
    }
    if (["RESERVE","RESERVATION_RELEASE","COMMIT","COMMIT_RELEASE","PICK_TO_STAGING","RETURN_TO_SHELF","HANDOVER_OUT"].includes(m.type) || m.variant?.startsWith("STAGING")) m.reservationLineId=line!.id;
    if (!m.fulfillmentRequestId) continue;
    const [existing] = await tx.select().from(fulfillmentRequests).where(or(eq(fulfillmentRequests.reservationId,m.reservationId),eq(fulfillmentRequests.id,m.fulfillmentRequestId)));
    if (!existing) {
      await tx.insert(fulfillmentRequests).values({id:m.fulfillmentRequestId,reservationId:m.reservationId,storefrontId:header!.storefrontId,storefrontOrderRef:header!.storefrontOrderRef,deliveryMethod:"PICKUP",shipBy:"2030-01-01"});
      await tx.insert(fulfillmentLines).values({id:createUuidV7(),fulfillmentRequestId:m.fulfillmentRequestId,reservationId:m.reservationId,reservationLineId:line!.id,skuId:m.skuId,allocationId:m.allocationId,quantity:line!.quantity});
    }
    if ((!existing || existing.id === m.fulfillmentRequestId) && (m.type === "PICK_TO_STAGING" || m.type === "RETURN_TO_SHELF" && m.scanConfirmed)) {
      if (m.quantity < 1 || m.quantity > 1000) continue;
      const rows = await tx.insert(unitConfirmations).values(Array.from({length:m.quantity},()=>({id:createUuidV7(),reservationId:m.reservationId!,fulfillmentRequestId:m.fulfillmentRequestId!,
        reservationLineId:line!.id,skuId:m.skuId,allocationId:m.allocationId!,action:m.type,method:"SCAN",quantity:1,actorUserId:userId,scannedIdentifier:"fixture"}))).returning();
      m.unitConfirmationIds=rows.map((r)=>r.id);
    }
  }
  return movements;
}
