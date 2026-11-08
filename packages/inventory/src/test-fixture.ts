import { eq } from "drizzle-orm";
import { getDb, allocations, fulfillmentRequests, legalEntities, poolLocations, stockLedger, stockPools, storefronts } from "@khidi/db";
import { createSkuDraft } from "@khidi/products";
import { createUuidV7 } from "@khidi/shared";
import { applyStockMovements } from "./engine.ts";
import type { StockMovement } from "./types.ts";
import { primitiveWorkflowFixture } from "./primitive-workflow.test-fixture.ts";

export async function inventoryFixture(seed = true) {
  const db=getDb();
  const admin=(await db.query.users.findFirst({where:(t,{eq})=>eq(t.role,"ADMIN")}))!;
  const actor={userId:admin.id}, sku=await createSkuDraft(db,actor,{});
  const entities=await db.insert(legalEntities).values([0,1].map(()=>({id:createUuidV7(),key:"fixture-"+createUuidV7(),legalName:"Inventory fixture",taxId:createUuidV7(),pricesIncludeVat:true}))).returning();
  const stores=await db.insert(storefronts).values([entities[0]!,entities[0]!,entities[1]!].map((entity)=>({id:createUuidV7(),key:"fixture-"+createUuidV7(),name:"Inventory fixture",domain:createUuidV7()+".example.test",sellerEntityId:entity.id,mediaBaseUrl:"https://media.example.test"}))).returning();
  const pools=await db.insert(stockPools).values(entities.map((entity)=>({id:createUuidV7(),ownerEntityId:entity.id,name:"Inventory fixture"}))).returning();
  await db.insert(poolLocations).values(pools.flatMap((pool)=>(["SHELF","STAGING"] as const).map((kind)=>({id:createUuidV7(),poolId:pool.id,kind,name:kind}))));
  const as=await db.insert(allocations).values([0,1].map((i)=>({id:createUuidV7(),poolId:pools[0]!.id,storefrontId:stores[i]!.id,skuId:sku.id}))).returning();
  const base={poolId:pools[0]!.id,skuId:sku.id};
  const line={...base,allocationId:as[0]!.id,reservationId:createUuidV7(),fulfillmentRequestId:createUuidV7()};
  // Count/loss fixture hooks are separate from the real database unit-confirmation gate.
  const proofs={assertApprovedCountLine:async()=>{},assertScanConfirmedReturn:async()=>{},cancelLostFulfillmentLine:async()=>{}};
  const apply=(movements: StockMovement[])=>db.transaction(async(tx)=>{
    const result=await applyStockMovements(tx,actor,await primitiveWorkflowFixture(tx,admin.id,movements),proofs);
    // Primitive tests bypass the domain lifecycle. Close their fixture request when all held
    // units have been released/handed over/lost, so drain tests do not leave phantom work.
    if(result.status==="APPLIED") for(const id of new Set(movements.flatMap((m)=>m.reservationId ? [m.reservationId] : []))) {
      const rows=await tx.select().from(stockLedger).where(eq(stockLedger.reservationId,id));
      if(rows.some((r)=>r.movementType==="RESERVE") && ["reservedDelta","committedDelta","stagingDelta"].every((key)=>rows.reduce((n,r)=>n+r[key as "reservedDelta"|"committedDelta"|"stagingDelta"],0)===0))
        await tx.update(fulfillmentRequests).set({status:"CANCELLED",cancelReason:"Primitive fixture fully closed"}).where(eq(fulfillmentRequests.reservationId,id));
    }
    return result;
  });
  if(seed) await apply([{...base,type:"STOCK_IN",quantity:100},{...base,allocationId:as[0]!.id,type:"ALLOCATE",quantity:60}]);
  return {db,actor,sku,entities,stores,pools,as,base,line,apply,proofs};
}
