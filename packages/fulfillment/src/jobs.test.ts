import { expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { allocationBalances, auditLogs, fulfillmentLines, fulfillmentRequests, outboxDeliveries, reservationExpiryJobs, reservations, stockLedger } from "@khidi/db";
import { extendReservation, setFulfillmentMode } from "@khidi/reservations";
import { applyWorkflowStockMovements } from "@khidi/inventory/workflow";
import { createUuidV7 } from "@khidi/shared";
import { createMediaJobRuntime, deployMediaJobs } from "../../media/src/jobs-runtime.ts";
import { reservationFixture } from "../../reservations/src/reservation.test-fixture.ts";
import { cancelFulfillment, confirmFulfillmentUnit, confirmOrder, reserveOrder } from "./index.ts";
import { dispatchReservationJobs, executeReservationExpiry } from "./jobs.ts";
import { RESERVATION_QUEUE } from "./job-names.ts";

type Fixture=Awaited<ReturnType<typeof reservationFixture>>;
const staff=(f:Fixture)=>({type:"USER" as const,userId:f.actor.userId});
const confirmation=(f:Fixture)=>({deliveryMethod:"PICKUP",shipBy:"2030-01-01",prices:[{skuId:f.sku.id,finalUnitPriceMinor:10000,currency:"GEL"}]});
async function pending(f:Fixture,cod=false) {
  return reserveOrder(f.db,f.principal,createUuidV7(),{storefrontOrderRef:"EXP-1",paymentMethod:cod ? "CASH_ON_DELIVERY" : "CARD",items:[{skuId:f.sku.id,quantity:2}],
    ...(cod ? {confirmation:confirmation(f)} : {})});
}
/** Advance a fixture deadline without changing the actual database clock or production timers. */
async function due(f:Fixture,id:string) {
  const expiresAt=new Date(Date.now()-1000);
  await f.db.update(reservations).set({expiresAt}).where(eq(reservations.id,id));
  const [job]=await f.db.insert(reservationExpiryJobs).values({id:createUuidV7(),reservationId:id,expiresAt}).returning();
  return job!;
}
it("expires RESERVED once, records the real job, and never creates fulfillment for a failed/expired card order",async()=>{
  const f=await reservationFixture(),r=await pending(f),id=r.body.reservationId!,job=await due(f,id);
  await Promise.all([executeReservationExpiry(f.db,job.id),executeReservationExpiry(f.db,job.id)]);
  expect((await f.db.select().from(reservations).where(eq(reservations.id,id)))[0]!.status).toBe("EXPIRED");
  expect(await f.db.select().from(stockLedger).where(and(eq(stockLedger.reservationId,id),eq(stockLedger.movementType,"RESERVATION_RELEASE"))))
    .toMatchObject([{quantity:2,actorUserId:null,actorType:"SYSTEM_JOB",actorId:job.id}]);
  expect(await f.db.select().from(auditLogs).where(and(eq(auditLogs.entityId,id),eq(auditLogs.action,"RESERVATION_EXPIRED"))))
    .toMatchObject([{actorType:"SYSTEM_JOB",actorId:job.id}]);
  expect(await f.db.select().from(fulfillmentRequests).where(eq(fulfillmentRequests.reservationId,id))).toHaveLength(0);
  expect((await confirmOrder(f.db,f.principal,createUuidV7(),{reservationId:id,confirmation:confirmation(f)}))).toMatchObject({status:409,body:{code:"RESERVATION_EXPIRED"}});
});
it("treats an old deadline as stale after extension, and commitments never expire",async()=>{
  const f=await reservationFixture(),r=await pending(f),id=r.body.reservationId!;
  const [original]=await f.db.select().from(reservationExpiryJobs).where(eq(reservationExpiryJobs.reservationId,id));
  expect((await executeReservationExpiry(f.db,original!.id)).status).toBe("EARLY");
  await extendReservation(f.db,f.principal,createUuidV7(),{reservationId:id,expiresAt:new Date(Date.parse(r.body.expiresAt!)+60000).toISOString()});
  expect((await executeReservationExpiry(f.db,original!.id)).status).toBe("STALE");
  await setFulfillmentMode(f.db,staff(f),createUuidV7(),{mode:"CONTROLLED_FULFILLMENT"});
  const next=await pending(f),confirmed=await confirmOrder(f.db,f.principal,createUuidV7(),{reservationId:next.body.reservationId,confirmation:confirmation(f)});
  const job=await due(f,confirmed.body.reservationId!);
  expect((await executeReservationExpiry(f.db,job.id)).status).toBe("CLOSED");
  expect((await f.db.select().from(reservations).where(eq(reservations.id,confirmed.body.reservationId!)))[0]!.status).toBe("COMMITTED");
});
it("holds the entire staged COD reservation for ACTION_REQUIRED and preserves a pending cancellation through expiry",async()=>{
  const f=await reservationFixture();await setFulfillmentMode(f.db,staff(f),createUuidV7(),{mode:"CONTROLLED_FULFILLMENT"});
  const r=await pending(f,true),requestId=r.body.fulfillmentRequestId!,[line]=await f.db.select().from(fulfillmentLines).where(eq(fulfillmentLines.fulfillmentRequestId,requestId));
  const command={fulfillmentRequestId:requestId,lineId:line!.id,action:"PICK",confirmation:{method:"SCAN",identifier:f.sku.internalSku}};
  await confirmFulfillmentUnit(f.db,staff(f),createUuidV7(),command);
  const job=await due(f,r.body.reservationId!);await executeReservationExpiry(f.db,job.id);
  expect((await f.db.select().from(fulfillmentRequests).where(eq(fulfillmentRequests.id,requestId)))[0]!.status).toBe("ACTION_REQUIRED");
  expect((await f.db.select().from(allocationBalances).where(eq(allocationBalances.allocationId,f.as[0]!.id)))[0]).toMatchObject({reserved:2,committed:0});
  await cancelFulfillment(f.db,staff(f),createUuidV7(),{fulfillmentRequestId:requestId,reason:"Cancel expired order"});
  const later=await due(f,r.body.reservationId!);await executeReservationExpiry(f.db,later.id);
  await confirmFulfillmentUnit(f.db,staff(f),createUuidV7(),{...command,action:"RETURN"});
  expect((await f.db.select().from(allocationBalances).where(eq(allocationBalances.allocationId,f.as[0]!.id)))[0]).toMatchObject({reserved:0,committed:0,availableToSell:60});
  expect((await f.db.select().from(reservations).where(eq(reservations.id,r.body.reservationId!)))[0]!.status).toBe("RELEASED");
});
it("serializes payment success, release and expiry on the same reservation; exactly one stock outcome wins",async()=>{
  for(const expired of [true,false]) {
    const f=await reservationFixture();await setFulfillmentMode(f.db,staff(f),createUuidV7(),{mode:"SIMPLIFIED_FULFILLMENT"});
    const r=await pending(f),id=r.body.reservationId!;
    const job=expired ? await due(f,id) : (await f.db.select().from(reservationExpiryJobs).where(eq(reservationExpiryJobs.reservationId,id)))[0]!;
    const [commit]=await Promise.all([confirmOrder(f.db,f.principal,createUuidV7(),{reservationId:id,confirmation:confirmation(f)}),executeReservationExpiry(f.db,job.id)]);
    expect(commit.body).toMatchObject(expired ? {code:"RESERVATION_EXPIRED"} : {status:"HANDED_OVER"});
    const rows=await f.db.select().from(stockLedger).where(eq(stockLedger.reservationId,id));
    expect(rows.filter((m)=>m.movementType==="RESERVATION_RELEASE")).toHaveLength(expired ? 1 : 0);
    expect(rows.filter((m)=>m.movementType==="COMMIT")).toHaveLength(expired ? 0 : 1);
    await executeReservationExpiry(f.db,job.id);
    expect(await f.db.select().from(stockLedger).where(eq(stockLedger.reservationId,id))).toEqual(rows);
  }
});
it("limits system-job and automatic-policy principals to their allowlists, deadline and frozen mode",async()=>{
  const f=await reservationFixture(),r=await pending(f),[job]=await f.db.select().from(reservationExpiryJobs).where(eq(reservationExpiryJobs.reservationId,r.body.reservationId!));
  const base={poolId:f.pool.id,skuId:f.sku.id,allocationId:f.as[0]!.id,reservationId:r.body.reservationId!,quantity:1};
  const p={type:"SYSTEM_JOB" as const,jobId:job!.id,reservationId:r.body.reservationId!};
  for(const type of ["RESERVE","COMMIT","PICK_TO_STAGING","RESERVATION_RELEASE"] as const)
    await expect(applyWorkflowStockMovements(f.db,p,[{...base,type}])).rejects.toMatchObject({code:"FORBIDDEN"});
  const automatic={type:"SYSTEM_WORKFLOW" as const,policy:"SIMPLIFIED_FULFILLMENT" as const,reservationId:r.body.reservationId!,storefrontId:f.store.id,triggerApiKeyId:f.principal.apiKeyId,triggerCallId:createUuidV7()};
  for(const type of ["RESERVE","RESERVATION_RELEASE","COMMIT_RELEASE"] as const)
    await expect(applyWorkflowStockMovements(f.db,automatic,[{...base,type}])).rejects.toMatchObject({code:"FORBIDDEN"});
});
it("enqueues expiry with its outbox acknowledgement atomically using only deployed queues and hub_app",async()=>{
  await deployMediaJobs([],[RESERVATION_QUEUE]);const boss=await createMediaJobRuntime();
  try {
    const f=await reservationFixture(),r=await pending(f),[job]=await f.db.select().from(reservationExpiryJobs).where(eq(reservationExpiryJobs.reservationId,r.body.reservationId!));
    await expect(f.db.transaction(async(tx)=>{await dispatchReservationJobs(tx,boss,job!.id);throw new Error("Rollback after enqueue");})).rejects.toThrow("Rollback after enqueue");
    expect((await boss.findJobs(RESERVATION_QUEUE)).some((j)=>j.id===job!.id)).toBe(false);
    expect(await dispatchReservationJobs(f.db,boss,job!.id)).toBe(1);
    expect(await dispatchReservationJobs(f.db,boss,job!.id)).toBe(0);
    expect((await boss.findJobs(RESERVATION_QUEUE)).filter((j)=>j.id===job!.id)).toHaveLength(1);
    expect(await f.db.select().from(outboxDeliveries).where(and(eq(outboxDeliveries.consumer,"reservation-jobs"),eq(outboxDeliveries.status,"DELIVERED"))))
      .toContainEqual(expect.objectContaining({status:"DELIVERED"}));
  } finally {await boss.stop({graceful:true});}
},60000);
