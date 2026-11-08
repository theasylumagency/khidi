import { and, eq, isNull, or, gt, sql } from "drizzle-orm";
import { allocations, reservations, reservationExpiryJobs, storefrontApiKeys, users, scanTasks, type DbExecutor } from "@khidi/db";
import type { DomainActor } from "@khidi/domain";
import { AppError } from "@khidi/shared";
import type { StockMovement } from "./types.ts";

export type WorkflowPrincipal =
  | { type: "USER"; userId: string }
  | { type: "STOREFRONT_SERVICE"; apiKeyId: string; storefrontId: string }
  | { type: "SYSTEM_JOB"; jobId: string; reservationId: string }
  | { type: "SYSTEM_WORKFLOW"; policy: "SIMPLIFIED_FULFILLMENT"; reservationId: string; storefrontId: string; triggerApiKeyId: string; triggerCallId: string };

export function workflowActor(p: WorkflowPrincipal): DomainActor {
  if (p.type === "USER") return { userId: p.userId, principalType: p.type, principalId: p.userId };
  if (p.type === "STOREFRONT_SERVICE") return { storefrontId: p.storefrontId, principalType: p.type, principalId: p.apiKeyId };
  if (p.type === "SYSTEM_JOB") return { principalType: p.type, principalId: p.jobId };
  return { storefrontId: p.storefrontId, principalType: p.type, principalId: p.policy, triggerApiKeyId: p.triggerApiKeyId, triggerCallId: p.triggerCallId };
}
function deny(): never { throw new AppError("FORBIDDEN", "This principal cannot perform this workflow operation."); }
export async function authorizeWorkflowPrincipal(tx: DbExecutor, p: WorkflowPrincipal) {
  if (p.type === "USER") {
    const [user] = await tx.select().from(users).where(and(eq(users.id,p.userId),eq(users.active,true)));
    if (!user || !["ADMIN","ORDER_MANAGER","WAREHOUSE"].includes(user.role)) deny();
    return user;
  }
  if (p.type === "SYSTEM_JOB") {
    const [job] = await tx.select().from(reservationExpiryJobs).where(and(eq(reservationExpiryJobs.id,p.jobId),eq(reservationExpiryJobs.reservationId,p.reservationId)));
    if (!job) deny();
    return;
  }
  const keyId = p.type === "STOREFRONT_SERVICE" ? p.apiKeyId : p.triggerApiKeyId;
  const [key] = await tx.select().from(storefrontApiKeys).where(and(eq(storefrontApiKeys.id,keyId),eq(storefrontApiKeys.storefrontId,p.storefrontId),
    eq(storefrontApiKeys.active,true),isNull(storefrontApiKeys.revokedAt),or(isNull(storefrontApiKeys.expiresAt),gt(storefrontApiKeys.expiresAt,sql`clock_timestamp()`))));
  if (!key) deny();
}

/** Capability entry point, private to the two workflow modules. Never trusts a supplied role. */
export async function authorizeWorkflowMovements(tx: DbExecutor, p: WorkflowPrincipal, movements: readonly StockMovement[]) {
  const user = await authorizeWorkflowPrincipal(tx,p);
  for (const m of movements) {
    const [header] = m.reservationId ? await tx.select().from(reservations).where(eq(reservations.id,m.reservationId)) : [];
    const [allocation] = m.allocationId ? await tx.select().from(allocations).where(eq(allocations.id,m.allocationId)) : [];
    if (!header || !allocation || allocation.storefrontId !== header.storefrontId || header.status === "HANDED_OVER") deny();
    if (p.type === "STOREFRONT_SERVICE") {
      if (header.storefrontId !== p.storefrontId || !["RESERVE","RESERVATION_RELEASE","COMMIT","COMMIT_RELEASE"].includes(m.type)) deny();
      if (m.type === "COMMIT" && ["CASH_ON_DELIVERY","PAY_ON_PICKUP"].includes(header.paymentMethod)) deny();
    } else if (p.type === "SYSTEM_WORKFLOW") {
      if (header.id !== p.reservationId || header.storefrontId !== p.storefrontId || header.fulfillmentMode !== p.policy ||
        !["COMMIT","PICK_TO_STAGING","HANDOVER_OUT"].includes(m.type)) deny();
    } else if (p.type === "SYSTEM_JOB") {
      const [job] = await tx.select().from(reservationExpiryJobs).where(and(eq(reservationExpiryJobs.id,p.jobId),isNull(reservationExpiryJobs.processedAt),
        eq(reservationExpiryJobs.expiresAt,header.expiresAt),sql`${reservationExpiryJobs.expiresAt} <= clock_timestamp()`));
      if (!job || header.id !== p.reservationId || header.status !== "RESERVED" || m.type !== "RESERVATION_RELEASE") deny();
    } else {
      const allowed = ["PICK_TO_STAGING","RETURN_TO_SHELF","HANDOVER_OUT","COMMIT"];
      if (user?.role === "ADMIN" || user?.role === "ORDER_MANAGER") allowed.push("RESERVATION_RELEASE","COMMIT_RELEASE");
      if (user?.role === "ADMIN") allowed.push("ADJUSTMENT");
      if (!allowed.includes(m.type) || (m.type === "ADJUSTMENT" && !m.variant?.startsWith("STAGING"))) deny();
      if (m.type === "COMMIT") {
        const handover=movements[movements.indexOf(m)+1];
        if (header.fulfillmentMode!=="CONTROLLED_FULFILLMENT" || !["CASH_ON_DELIVERY","PAY_ON_PICKUP"].includes(header.paymentMethod)
          || handover?.type!=="HANDOVER_OUT" || handover.reservationId!==m.reservationId || handover.reservationLineId!==m.reservationLineId
          || handover.fulfillmentRequestId!==m.fulfillmentRequestId || handover.allocationId!==m.allocationId
          || handover.poolId!==m.poolId || handover.skuId!==m.skuId || handover.quantity!==m.quantity) deny();
      }
      if (user?.role === "WAREHOUSE") {
        const [task] = m.fulfillmentRequestId ? await tx.select().from(scanTasks).where(and(eq(scanTasks.fulfillmentRequestId,m.fulfillmentRequestId),
          eq(scanTasks.taskType,"PICK"),or(eq(scanTasks.assigneeUserId,p.userId),eq(scanTasks.assigneeRole,"WAREHOUSE")),
          or(eq(scanTasks.status,"OPEN"),eq(scanTasks.status,"IN_PROGRESS")))) : [];
        if (!task) deny();
      }
    }
  }
}
