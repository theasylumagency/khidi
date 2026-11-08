import { PgBoss, fromDrizzle } from "pg-boss";
import { and, eq, isNull, sql } from "drizzle-orm";
import { outboxDeliveries, outboxEvents, reservationExpiryJobs, type DbExecutor } from "@khidi/db";
import { withDomainTransaction } from "@khidi/domain";
import { workflowActor } from "@khidi/inventory/workflow";
import { databaseNow, expireLocked, lockReservation } from "@khidi/reservations/internal";
import { AppError } from "@khidi/shared";
import { RESERVATION_DEAD_LETTER, RESERVATION_QUEUE } from "./job-names.ts";

/** Each deadline has a durable job identity. Header serialization makes retries harmless. */
export async function executeReservationExpiry(db:DbExecutor,jobId:string) {
  const [intent]=await db.select().from(reservationExpiryJobs).where(eq(reservationExpiryJobs.id,jobId));
  if(!intent) throw new AppError("NOT_FOUND","Reservation expiry job not found.");
  const principal={type:"SYSTEM_JOB" as const,jobId,reservationId:intent.reservationId};
  return withDomainTransaction(db,workflowActor(principal),async(ctx)=>{
    const state=await lockReservation(ctx.tx,principal,intent.reservationId);
    const [job]=await ctx.tx.select().from(reservationExpiryJobs).where(eq(reservationExpiryJobs.id,jobId)).for("update");
    if(job!.processedAt) return {status:"REPLAYED"};
    const stale=job!.expiresAt.getTime()!==state.header.expiresAt.getTime();
    if(!stale && state.header.status==="RESERVED" && await databaseNow(ctx.tx)<job!.expiresAt) return {status:"EARLY"};
    const expired=!stale && await expireLocked(ctx,principal,state);
    await ctx.tx.update(reservationExpiryJobs).set({processedAt:await databaseNow(ctx.tx)}).where(eq(reservationExpiryJobs.id,jobId));
    const status=stale ? "STALE" : expired ? "PROCESSED" : "CLOSED";
    await ctx.recordAudit({action:"RESERVATION_EXPIRY_JOB_PROCESSED",entityType:"reservation_expiry_job",entityId:jobId,after:{status,reservationId:intent.reservationId}});
    await ctx.emitOutboxEvent({eventType:"RESERVATION_UPDATED",aggregateType:"reservation",aggregateId:intent.reservationId,payload:{jobId,expiryJobStatus:status},consumers:[]});
    return {status};
  });
}

/** pg-boss insertion and outbox acknowledgement commit or roll back together. */
export async function dispatchReservationJobs(db:DbExecutor,boss:Pick<PgBoss,"send">,onlyJobId?:string) {
  return withDomainTransaction(db,{},async(ctx)=>{
    const pending=await ctx.tx.select({delivery:outboxDeliveries,payload:outboxEvents.payloadJson}).from(outboxDeliveries)
      .innerJoin(outboxEvents,eq(outboxEvents.id,outboxDeliveries.outboxEventId))
      .where(and(eq(outboxDeliveries.consumer,"reservation-jobs"),eq(outboxDeliveries.status,"PENDING"),
        onlyJobId ? sql`${outboxEvents.payloadJson}->>'jobId' = ${onlyJobId}` : undefined)).limit(50).for("update",{skipLocked:true,of:outboxDeliveries});
    for(const {delivery,payload} of pending) {
      if(typeof payload.jobId!=="string") throw new Error("Invalid reservation job intent.");
      const [job]=await ctx.tx.select().from(reservationExpiryJobs).where(eq(reservationExpiryJobs.id,payload.jobId));
      if(!job) throw new Error("Reservation expiry job intent is missing.");
      await boss.send(RESERVATION_QUEUE,{jobId:job.id},{id:job.id,startAfter:job.expiresAt,db:fromDrizzle(ctx.tx,sql)});
      await ctx.tx.update(outboxDeliveries).set({status:"DELIVERED",deliveredAt:new Date(),attempts:delivery.attempts+1}).where(eq(outboxDeliveries.id,delivery.id));
      await ctx.recordAudit({action:"RESERVATION_JOB_DISPATCHED",entityType:"outbox_delivery",entityId:delivery.id,after:{jobId:job.id}});
      await ctx.emitOutboxEvent({eventType:"RESERVATION_UPDATED",aggregateType:"outbox_delivery",aggregateId:delivery.id,payload:{jobId:job.id,dispatched:true},consumers:[]});
    }
    return pending.length;
  });
}
export async function startReservationWorkers(db:DbExecutor,boss:PgBoss) {
  await boss.work<{jobId:string}>(RESERVATION_QUEUE,{batchSize:1},async(jobs)=>{
    for(const job of jobs) {
      if(job.id!==job.data.jobId) throw new Error("Reservation job identity mismatch.");
      const result=await executeReservationExpiry(db,job.data.jobId);
      if(result.status==="EARLY") throw new Error("Reservation deadline has not arrived; retry safely.");
    }
  });
  await boss.work<{jobId:string}>(RESERVATION_DEAD_LETTER,{batchSize:1},async(jobs)=>{
    for(const job of jobs) {
      const [intent]=await db.select().from(reservationExpiryJobs).where(and(eq(reservationExpiryJobs.id,job.data.jobId),isNull(reservationExpiryJobs.processedAt)));
      if(!intent) continue;
      await withDomainTransaction(db,workflowActor({type:"SYSTEM_JOB",jobId:intent.id,reservationId:intent.reservationId}),async(ctx)=>{
        await ctx.recordAudit({action:"RESERVATION_EXPIRY_DEAD_LETTER",entityType:"reservation_expiry_job",entityId:intent.id,after:{severity:"ACTION_REQUIRED"}});
        await ctx.emitOutboxEvent({eventType:"STOCK_REVIEW_REQUIRED",aggregateType:"reservation",aggregateId:intent.reservationId,
          payload:{jobId:intent.id,reason:"RESERVATION_EXPIRY_DEAD_LETTER",severity:"ACTION_REQUIRED"},consumers:["notifications"]});
      });
    }
  });
}
