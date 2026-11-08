import { asc, desc, eq, inArray, or } from "drizzle-orm";
import { fulfillmentHistory, fulfillmentLines, fulfillmentRequests, reservations, skus, storefronts, unitConfirmations, users, type DbExecutor } from "@khidi/db";
import { acquireDomainLocks } from "@khidi/domain/locking";
import { parseInput } from "@khidi/reservations";
import { workflowCommand } from "@khidi/reservations/internal";
import { FULFILLMENT_CONFIGURATION_LOCK, readFrozenMode } from "../../reservations/src/mode.ts";
import { AppError } from "@khidi/shared";
import { z } from "zod";
import { cancelFulfillment, markLostInStaging } from "./workflow.ts";
type Staff={type:"USER";userId:string};
export async function assertFulfillmentOfficeAccess(db:DbExecutor,p:Staff) {
  const [user]=await db.select().from(users).where(eq(users.id,p.userId));
  if(!user?.active || !["ADMIN","ORDER_MANAGER"].includes(user.role))throw new AppError("FORBIDDEN","Fulfillment office access required.");
  return user;
}
export async function listFulfillmentOffice(db:DbExecutor,p:Staff,actionRequired=false) {
  const user=await assertFulfillmentOfficeAccess(db,p);
  const [mode,requests,expiry]=await Promise.all([
    readFrozenMode(db),
    db.select({id:fulfillmentRequests.id,orderRef:fulfillmentRequests.storefrontOrderRef,store:storefronts.name,status:fulfillmentRequests.status,shipBy:fulfillmentRequests.shipBy,
      requiresReturnToShelf:fulfillmentRequests.requiresReturnToShelf,createdAt:fulfillmentRequests.createdAt}).from(fulfillmentRequests).innerJoin(storefronts,eq(storefronts.id,fulfillmentRequests.storefrontId))
      .where(actionRequired ? or(eq(fulfillmentRequests.status,"ACTION_REQUIRED"),eq(fulfillmentRequests.requiresReturnToShelf,true)) : undefined).orderBy(desc(fulfillmentRequests.createdAt)).limit(100),
    db.select({id:reservations.id,orderRef:reservations.storefrontOrderRef,store:storefronts.name,paymentMethod:reservations.paymentMethod,expiresAt:reservations.expiresAt})
      .from(reservations).innerJoin(storefronts,eq(storefronts.id,reservations.storefrontId)).where(eq(reservations.status,"RESERVED")).orderBy(asc(reservations.expiresAt)).limit(100)
  ]);
  const latest=requests.length ? await db.selectDistinctOn([fulfillmentHistory.fulfillmentRequestId],{id:fulfillmentHistory.fulfillmentRequestId,confirmation:fulfillmentHistory.confirmation})
    .from(fulfillmentHistory).where(inArray(fulfillmentHistory.fulfillmentRequestId,requests.map((r)=>r.id))).orderBy(asc(fulfillmentHistory.fulfillmentRequestId),desc(fulfillmentHistory.createdAt),desc(fulfillmentHistory.id)) : [];
  return {requests:requests.map((r)=>({...r,confirmation:latest.find((h)=>h.id===r.id)?.confirmation??null})),expiry,canUseControlledActions:mode==="CONTROLLED_FULFILLMENT",...(user.role==="ADMIN" ? {mode} : {})};
}
export async function getFulfillmentOfficeDetail(db:DbExecutor,p:Staff,id:string) {
  const user=await assertFulfillmentOfficeAccess(db,p);parseInput(z.string().uuid(),id);
  const [record]=await db.select({request:fulfillmentRequests,reservation:reservations,storeName:storefronts.name}).from(fulfillmentRequests)
    .innerJoin(reservations,eq(reservations.id,fulfillmentRequests.reservationId)).innerJoin(storefronts,eq(storefronts.id,fulfillmentRequests.storefrontId)).where(eq(fulfillmentRequests.id,id));
  if(!record)throw new AppError("NOT_FOUND","Fulfillment request not found.");
  const [mode,lines,history,confirmations]=await Promise.all([readFrozenMode(db),
    db.select({id:fulfillmentLines.id,skuId:fulfillmentLines.skuId,code:skus.internalSku,quantity:fulfillmentLines.quantity,picked:fulfillmentLines.pickedQuantity,returned:fulfillmentLines.returnedQuantity,
      lost:fulfillmentLines.lostQuantity,handedOver:fulfillmentLines.handedOverQuantity}).from(fulfillmentLines).innerJoin(skus,eq(skus.id,fulfillmentLines.skuId)).where(eq(fulfillmentLines.fulfillmentRequestId,id)),
    db.select().from(fulfillmentHistory).where(eq(fulfillmentHistory.fulfillmentRequestId,id)).orderBy(asc(fulfillmentHistory.createdAt),asc(fulfillmentHistory.id)),
    db.select().from(unitConfirmations).where(eq(unitConfirmations.fulfillmentRequestId,id)).orderBy(asc(unitConfirmations.createdAt),asc(unitConfirmations.id))]);
  const closed=["HANDED_OVER","CANCELLED"].includes(record.request.status),controlled=mode==="CONTROLLED_FULFILLMENT"&&record.reservation.fulfillmentMode==="CONTROLLED_FULFILLMENT";
  return {request:record.request,storeName:record.storeName,paymentMethod:record.reservation.paymentMethod,
    reservationStatus:record.reservation.status,expiresAt:record.reservation.status==="RESERVED" ? record.reservation.expiresAt : null,
    lines,history,confirmations,canCancel:controlled&&!closed,canMarkLost:controlled&&record.request.status!=="HANDED_OVER"&&["RESERVED","COMMITTED"].includes(record.reservation.status)&&user.role==="ADMIN"&&lines.some((l)=>l.picked-l.returned-l.lost-l.handedOver>0)};
}
export async function fulfillmentOfficeAction(db:DbExecutor,p:Staff,key:string,raw:unknown) {
  const input=parseInput(z.discriminatedUnion("action",[
    z.object({action:z.literal("CANCEL"),fulfillmentRequestId:z.string().uuid(),reason:z.string().trim().min(1).max(1000)}).strict(),
    z.object({action:z.literal("LOST"),fulfillmentRequestId:z.string().uuid(),lineId:z.string().uuid(),reason:z.string().trim().min(1).max(1000)}).strict()
  ]),raw);
  await assertFulfillmentOfficeAccess(db,p);
  return workflowCommand(db,p,"office-action",key,input,async(ctx)=>{
    await acquireDomainLocks(ctx.tx,{sharedAdvisoryKeys:[FULFILLMENT_CONFIGURATION_LOCK]});
    const detail=await getFulfillmentOfficeDetail(ctx.tx,p,input.fulfillmentRequestId);
    if(input.action==="CANCEL"&&!detail.canCancel || input.action==="LOST"&&!detail.canMarkLost)throw new AppError("FORBIDDEN","Controlled action unavailable.");
    const {action,...command}=input;
    return action==="CANCEL" ? cancelFulfillment(ctx.tx,p,key,command) : markLostInStaging(ctx.tx,p,key,command);
  });
}
