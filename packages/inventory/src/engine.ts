import { and, asc, desc, eq, inArray, lte } from "drizzle-orm";
import { z } from "zod";
import {
  allocationBalances, allocations, entityRelationships, poolLocations, poolSkuBalances, stockLedger, stockPools,
  storefronts, userEntityMemberships, users, skus, accountingMappings, type DbExecutor
} from "@khidi/db";
import { withDomainTransaction, type DomainActor, type DomainTransactionContext } from "@khidi/domain";
import { acquireDomainLocks } from "@khidi/domain/locking";
import { AppError, createUuidV7 } from "@khidi/shared";
import { MOVEMENT_MATRIX, type MatrixRow } from "./matrix.ts";
import { LEDGER_MOVEMENT_TYPES, type StockMovement } from "./types.ts";

const movementSchema = z.object({
  type: z.enum(LEDGER_MOVEMENT_TYPES), poolId: z.string().uuid(), skuId: z.string().uuid(),
  quantity: z.number().int().positive().max(2_147_483_647), variant: z.string().optional(), allocationId: z.string().uuid().optional(),
  reason: z.string().trim().min(1).max(4000).optional(), documentRef: z.string().trim().min(1).max(1000).optional(), transferKey: z.string().min(1).optional(),
  reservationId: z.string().uuid().optional(), fulfillmentRequestId: z.string().uuid().optional(),
  paymentMethod: z.enum(["CARD", "BANK_INSTALLMENT", "CASH_ON_DELIVERY", "PAY_ON_PICKUP"]).optional(),
  approvedCountLineId: z.string().uuid().optional(), scanConfirmed: z.boolean().optional(), cancelLostLine: z.boolean().optional()
}).strict();
type PoolBalance = { shelf: number; staging: number; allocatedTotal: number };
type AllocationBalance = { allocated: number; reserved: number; committed: number };
type LedgerRow = typeof stockLedger.$inferSelect;
type Allocation = typeof allocations.$inferSelect;
type Pool = typeof stockPools.$inferSelect;
type Store = typeof storefronts.$inferSelect;
/** Installed by trusted count/fulfillment services. These callbacks share this transaction. */
export interface StockWorkflowProofs {
  assertApprovedCountLine?: (ctx: DomainTransactionContext, movement: StockMovement) => Promise<void>;
  assertScanConfirmedReturn?: (ctx: DomainTransactionContext, movement: StockMovement) => Promise<void>;
  cancelLostFulfillmentLine?: (ctx: DomainTransactionContext, movement: StockMovement) => Promise<void>;
}
type Effect = { m: StockMovement; rule: MatrixRow; pool: Pool; allocation?: Allocation; store?: Store; mode: "CONSIGNMENT" | "PURCHASE" | null; crossEntity: boolean; row: typeof stockLedger.$inferInsert };
const pairKey = (poolId: string, skuId: string) => poolId + ":" + skuId;
const available = (a: AllocationBalance) => a.allocated - a.reserved - a.committed;
const unallocated = (p: PoolBalance) => p.shelf + p.staging - p.allocatedTotal;
function requireCondition(condition: unknown, message: string) { if (!condition) throw new AppError("PRECONDITION_FAILED", message); }

/** Rule A is a proposal, never an implicit allocation choice. The caller chooses DEALLOCATE rows. */
export function negativeAdjustmentPlan(quantity: number, pool: PoolBalance, candidates: { allocationId: string; availableToSell: number }[]) {
  const needed = Math.max(0, quantity - unallocated(pool));
  if (quantity <= pool.shelf && needed === 0) return { status: "READY" as const, needed: 0, candidates: [] };
  const eligible = candidates.filter((a) => a.availableToSell > 0);
  if (quantity > pool.shelf || eligible.reduce((sum, a) => sum + a.availableToSell, 0) < needed) {
    return { status: "CRITICAL" as const, needed, candidates: eligible };
  }
  return { status: "REQUIRES_DEALLOCATION" as const, needed, candidates: eligible };
}

async function relationship(db: DbExecutor, ownerId: string, receivingId: string): Promise<"CONSIGNMENT" | "PURCHASE" | null> {
  const [row] = await db.select().from(entityRelationships)
    .where(and(eq(entityRelationships.fromEntityId, ownerId), eq(entityRelationships.toEntityId, receivingId), lte(entityRelationships.effectiveFrom, new Date())))
    .orderBy(desc(entityRelationships.effectiveFrom), desc(entityRelationships.id)).limit(1);
  return row?.mode === "CONSIGNMENT" || row?.mode === "PURCHASE" ? row.mode : null;
}

/** Reservation/fulfillment quantities are proven by ledger history, never supplied as balance assertions. */
function lineState(history: LedgerRow[], m: StockMovement) {
  const rows = history.filter((r) => r.allocationId === m.allocationId && r.reservationId === m.reservationId);
  const reserved = rows.reduce((n,r) => n + r.reservedDelta, 0), committed = rows.reduce((n,r) => n + r.committedDelta, 0);
  const staged = rows.reduce((n,r) => n + r.stagingDelta, 0);
  const requestStaged = rows.filter((r) => r.fulfillmentRequestId === m.fulfillmentRequestId).reduce((n,r) => n + r.stagingDelta, 0);
  const payment = rows.find((r) => r.movementType === "RESERVE")?.paymentMethod;
  const cod = payment === "CASH_ON_DELIVERY" || payment === "PAY_ON_PICKUP";
  return { reserved, committed, staged, requestStaged, payment, cod };
}

function checkRule(m: StockMovement, rule: MatrixRow, pool: PoolBalance, allocation: AllocationBalance | undefined, history: LedgerRow[]) {
  const n = m.quantity;
  if (m.type === "WRITE_OFF" || m.type === "STOCK_OUT" || m.type === "ADJUSTMENT") requireCondition(m.reason, "This movement requires a reason.");
  const a = allocation ?? { allocated: 0, reserved: 0, committed: 0 };
  const line = lineState(history, m);
  const needsLine = ["RESERVE","RELEASE_RESERVED","COMMIT","RELEASE_COMMITTED","PICK","RETURN","HANDOVER","LOST_RESERVED","LOST_COMMITTED"].includes(rule.precondition);
  if (needsLine) requireCondition(m.reservationId, "A reservation reference is required.");
  if (["PICK","RETURN","HANDOVER","LOST_RESERVED","LOST_COMMITTED"].includes(rule.precondition)) requireCondition(m.fulfillmentRequestId, "A fulfillment request reference is required.");
  switch (rule.precondition) {
    case "UNALLOCATED": requireCondition(n <= unallocated(pool) && (rule.deltas[0] >= 0 || n <= pool.shelf), "Quantity exceeds unallocated shelf stock."); break;
    case "AVAILABLE": requireCondition(n <= available(a), "Quantity exceeds available allocation stock."); break;
    case "COUNT": case "NEGATIVE_COUNT": requireCondition(m.approvedCountLineId, "An approved count line is required."); break;
    case "RESERVE":
      requireCondition(n <= available(a), "Quantity exceeds available stock.");
      requireCondition(m.paymentMethod && (!line.payment || m.paymentMethod === line.payment), "A consistent payment method is required."); break;
    case "RELEASE_RESERVED": requireCondition(n <= line.reserved - (line.cod ? Math.max(0, line.staged - line.committed) : 0), "Reserved units are missing or still staged; return them first."); break;
    case "COMMIT": requireCondition(n <= line.reserved, "Quantity exceeds this line's reservations."); break;
    case "RELEASE_COMMITTED": requireCondition(n <= line.committed - (line.cod ? Math.min(line.staged, line.committed) : line.staged), "Committed units are missing or still staged; return them first."); break;
    case "PICK": requireCondition(n <= pool.shelf && n <= line.committed + (line.cod ? line.reserved : 0) - line.staged, "Picking requires unpicked committed units, or COD/pickup reserved units."); break;
    case "RETURN": requireCondition(m.scanConfirmed && n <= line.requestStaged, "Return requires scan confirmation and staged units of this request."); break;
    case "HANDOVER": requireCondition(n <= line.committed && n <= line.requestStaged, "Handover requires this line's commitments and staged units."); break;
    case "LOST_RESERVED": requireCondition(m.cancelLostLine && line.cod && n <= line.reserved && n <= line.requestStaged, "Lost COD units require cancellation and staged reserved units."); break;
    case "LOST_COMMITTED": requireCondition(m.cancelLostLine && n <= line.committed && n <= line.requestStaged, "Lost units require cancellation and staged committed units."); break;
  }
}

async function criticalReview(ctx: DomainTransactionContext, movement: StockMovement, plan: ReturnType<typeof negativeAdjustmentPlan>) {
  await ctx.recordAudit({ action: "INVENTORY_CRITICAL", entityType: "sku", entityId: movement.skuId, after: { movement, plan, severity: "CRITICAL" }, reason: movement.reason });
  await ctx.emitOutboxEvent({ eventType: "STOCK_REVIEW_REQUIRED", aggregateType: "sku", aggregateId: movement.skuId,
    payload: { severity: "CRITICAL", poolId: movement.poolId, skuId: movement.skuId, reason: movement.reason, plan }, consumers: ["notifications"] });
}

/** All-or-none ledger primitive batch. No transport is exposed until the later workflows are implemented. */
export async function applyStockMovements(db: DbExecutor, actor: DomainActor, raw: readonly StockMovement[], proofs: StockWorkflowProofs = {}) {
  const parsed = z.array(movementSchema).min(1).max(1000).safeParse(raw);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid stock movements.");
  const movements = parsed.data;
  return withDomainTransaction(db, actor, async (ctx) => {
    const [user] = actor.userId ? await ctx.tx.select().from(users).where(and(eq(users.id,actor.userId),eq(users.active,true))) : [];
    if (!user || !["ADMIN","STOCK_MANAGER"].includes(user.role)) throw new AppError("FORBIDDEN", "Stock primitives require authorized staff.");
    const pools = await ctx.tx.select().from(stockPools).where(inArray(stockPools.id,[...new Set(movements.map((m)=>m.poolId))]));
    const poolMap = new Map(pools.map((p)=>[p.id,p]));
    const skuIds = [...new Set(movements.map((m)=>m.skuId))];
    const commitmentOnly = movements.every((m)=>["RESERVE","RESERVATION_RELEASE","COMMIT","COMMIT_RELEASE"].includes(m.type));
    if (!commitmentOnly) await acquireDomainLocks(ctx.tx, { skuIds });
    const allocationIds = [...new Set(movements.flatMap((m)=>m.allocationId ? [m.allocationId] : []))];
    // Include every allocation in touched pairs: Rule A needs a stable list of deallocation candidates.
    const touchedPairs = new Set(movements.map((m)=>pairKey(m.poolId,m.skuId)));
    const allAllocations = (await ctx.tx.select().from(allocations).where(and(inArray(allocations.poolId,pools.map((p)=>p.id)),inArray(allocations.skuId,skuIds))))
      .filter((a)=>touchedPairs.has(pairKey(a.poolId,a.skuId)));
    const aMap = new Map(allAllocations.map((a)=>[a.id,a]));
    const stores = allAllocations.length ? await ctx.tx.select().from(storefronts).where(inArray(storefronts.id,[...new Set(allAllocations.map((a)=>a.storefrontId))])) : [];
    const storeMap = new Map(stores.map((s)=>[s.id,s]));
    const memberships = await ctx.tx.select().from(userEntityMemberships).where(eq(userEntityMemberships.userId,user.id));
    const allowedOwners = new Set(memberships.map((m)=>m.legalEntityId));
    for (const m of movements) {
      const pool = poolMap.get(m.poolId);
      if (!pool?.active) throw new AppError("NOT_FOUND", "Active pool not found.");
      if (m.allocationId) {
        const allocation = aMap.get(m.allocationId);
        requireCondition(allocation && allocation.poolId === m.poolId && allocation.skuId === m.skuId, "Allocation does not match this movement's pool and SKU.");
      }
      if (user.role !== "ADMIN" && !allowedOwners.has(pool.ownerEntityId)) throw new AppError("FORBIDDEN", "Pool belongs to another entity.");
      if (user.role !== "ADMIN" && (m.variant?.startsWith("STAGING") || ["RESERVE","RESERVATION_RELEASE","COMMIT","COMMIT_RELEASE","PICK_TO_STAGING","RETURN_TO_SHELF","HANDOVER_OUT"].includes(m.type))) throw new AppError("FORBIDDEN", "This primitive requires an admin/domain workflow.");
    }
    await acquireDomainLocks(ctx.tx, commitmentOnly ? { allocationIds } : {
      poolBalances: movements.map((m)=>({poolId:m.poolId,skuId:m.skuId})), allocationIds: [...new Set([...allocationIds,...allAllocations.map((a)=>a.id)])] });
    const products = await ctx.tx.select().from(skus).where(inArray(skus.id,skuIds));
    requireCondition(products.length === skuIds.length && products.every((s)=>s.lifecycleState !== "ARCHIVED"), "Archived or missing SKU cannot receive stock movements.");
    const poolRows = await ctx.tx.select().from(poolSkuBalances).where(and(inArray(poolSkuBalances.poolId,pools.map((p)=>p.id)),inArray(poolSkuBalances.skuId,skuIds)));
    const pb = new Map(poolRows.filter((p)=>touchedPairs.has(pairKey(p.poolId,p.skuId))).map((p)=>[pairKey(p.poolId,p.skuId),{shelf:p.shelf,staging:p.staging,allocatedTotal:p.allocatedTotal}]));
    const allocationRows = allAllocations.length ? await ctx.tx.select().from(allocationBalances).where(inArray(allocationBalances.allocationId,allAllocations.map((a)=>a.id))) : [];
    const ab = new Map(allocationRows.map((a)=>[a.allocationId,{allocated:a.allocated,reserved:a.reserved,committed:a.committed}]));
    const history = await ctx.tx.select().from(stockLedger).where(and(inArray(stockLedger.poolId,pools.map((p)=>p.id)),inArray(stockLedger.skuId,skuIds))).orderBy(asc(stockLedger.createdAt),asc(stockLedger.id));
    const locations = await ctx.tx.select().from(poolLocations).where(inArray(poolLocations.poolId,pools.map((p)=>p.id)));
    const effects: Effect[] = [];
    const transfers = new Map<string, StockMovement[]>();
    for (const m of movements.filter((m)=>m.type.startsWith("TRANSFER_"))) {
      requireCondition(m.transferKey, "Transfers require an explicit pair key.");
      transfers.set(m.transferKey!, [...(transfers.get(m.transferKey!) ?? []),m]);
    }
    for (const pair of transfers.values()) {
      const [out,into] = pair;
      requireCondition(pair.length === 2 && out?.type === "TRANSFER_OUT" && into?.type === "TRANSFER_IN" && out.quantity === into.quantity && out.skuId === into.skuId && out.variant === into.variant, "Transfer must have equal OUT then IN legs in this batch.");
      if (out!.variant === "SAME_POOL") requireCondition(out!.poolId === into!.poolId && out!.allocationId !== into!.allocationId, "Reallocation requires two allocations of one pool.");
      else {
        const from = poolMap.get(out!.poolId)!, to = poolMap.get(into!.poolId)!;
        requireCondition(out!.variant === "CROSS_POOL" && from.id !== to.id && from.ownerEntityId !== to.ownerEntityId, "Purchase transfer requires distinct owner pools.");
        requireCondition(user.role === "ADMIN", "Cross-entity transfer requires admin.");
        requireCondition(out!.documentRef && into!.documentRef === out!.documentRef, "Both purchase legs require the same document reference.");
        requireCondition(await relationship(ctx.tx,from.ownerEntityId,to.ownerEntityId) === "PURCHASE", "Cross-pool transfer requires active PURCHASE.");
      }
    }
    for (const m of movements) {
      const rule = MOVEMENT_MATRIX.find((r)=>r.type === m.type && r.variant === (m.variant ?? "DEFAULT"));
      requireCondition(rule, "Unknown movement variant.");
      const r = rule!, pool = poolMap.get(m.poolId)!, a = m.allocationId ? aMap.get(m.allocationId) : undefined;
      requireCondition(r.allocation === !!m.allocationId && (!m.allocationId || a && a.poolId === m.poolId && a.skuId === m.skuId), "Allocation does not match this movement's pool and SKU.");
      const store = a ? storeMap.get(a.storefrontId) : undefined;
      let crossEntity = !!store && store.sellerEntityId !== pool.ownerEntityId;
      let mode = crossEntity ? await relationship(ctx.tx,pool.ownerEntityId,store!.sellerEntityId) : null;
      // Existing held lines complete despite later commercial configuration changes (C18).
      if (crossEntity && ["ALLOCATE","RESERVE","TRANSFER_IN"].includes(m.type)) requireCondition(mode === "CONSIGNMENT", "Cross-entity allocation requires active CONSIGNMENT.");
      if (m.type.startsWith("TRANSFER_") && m.variant === "CROSS_POOL") { mode = "PURCHASE"; crossEntity = true; }
      if (m.type.startsWith("TRANSFER_") && m.variant === "SAME_POOL") {
        const legs = transfers.get(m.transferKey!)!;
        const crossSeller = legs.map((leg)=>storeMap.get(aMap.get(leg.allocationId!)?.storefrontId ?? ""))
          .find((s)=>s && s.sellerEntityId !== pool.ownerEntityId);
        if (crossSeller) {
          crossEntity = true;
          mode = await relationship(ctx.tx,pool.ownerEntityId,crossSeller.sellerEntityId);
          requireCondition(mode === "CONSIGNMENT", "Cross-entity reallocation requires active CONSIGNMENT.");
        }
      }
      if (user.role !== "ADMIN" && crossEntity) throw new AppError("FORBIDDEN", "Cross-entity operations require admin.");
      if (crossEntity && !mode) mode = history.findLast((row)=>row.allocationId === m.allocationId)?.relationshipMode ?? null;
      const p = pb.get(pairKey(m.poolId,m.skuId)), b = a ? ab.get(a.id) : undefined;
      requireCondition(p, "Pool stock balance is not initialized.");
      checkRule(m,r,p!,b,history);
      if (r.precondition === "COUNT" || r.precondition === "NEGATIVE_COUNT") {
        requireCondition(proofs.assertApprovedCountLine, "Count workflow must verify its approved line inside the transaction.");
        await proofs.assertApprovedCountLine!(ctx,m);
      }
      if (r.precondition === "RETURN") {
        requireCondition(proofs.assertScanConfirmedReturn, "Return workflow must verify its scan inside the transaction.");
        await proofs.assertScanConfirmedReturn!(ctx,m);
      }
      if (r.precondition.startsWith("LOST")) requireCondition(proofs.cancelLostFulfillmentLine, "Lost-unit workflow must cancel the line in the same transaction.");
      if (m.type === "COMMIT" && lineState(history,m).cod) {
        const index = movements.indexOf(m);
        const handover = movements[index+1];
        requireCondition(handover?.type === "HANDOVER_OUT" && handover.quantity === m.quantity && handover.allocationId === m.allocationId && handover.reservationId === m.reservationId && handover.fulfillmentRequestId === m.fulfillmentRequestId,
          "COD/pickup COMMIT must immediately precede the matching handover in this batch.");
      }
      if (r.precondition === "NEGATIVE_COUNT") {
        const plan = negativeAdjustmentPlan(m.quantity,p!,allAllocations.filter((a)=>a.poolId === m.poolId && a.skuId === m.skuId).map((a)=>({allocationId:a.id,availableToSell:available(ab.get(a.id)!)})));
        if (plan.status !== "READY") {
          if (plan.status === "CRITICAL") await criticalReview(ctx,m,plan);
          return { status: plan.status, plan, rows: [] as LedgerRow[] };
        }
      }
      const d = r.deltas.map((coefficient)=>coefficient*m.quantity);
      const nextP = { shelf:p!.shelf+d[0]!, staging:p!.staging+d[1]!, allocatedTotal:p!.allocatedTotal+d[2]! };
      requireCondition(nextP.shelf >= 0 && nextP.staging >= 0 && nextP.allocatedTotal >= nextP.staging && unallocated(nextP) >= 0, "Movement violates pool invariants.");
      pb.set(pairKey(m.poolId,m.skuId),nextP);
      if (b && a) {
        const next = {allocated:b.allocated+d[3]!,reserved:b.reserved+d[4]!,committed:b.committed+d[5]!};
        requireCondition(next.allocated >= 0 && next.reserved >= 0 && next.committed >= 0 && available(next) >= 0, "Movement violates allocation invariants.");
        ab.set(a.id,next);
      }
      const location = r.location ? locations.find((l)=>l.poolId === m.poolId && l.kind === r.location) : null;
      requireCondition(!r.location || location, "Pool location is missing.");
      const row: typeof stockLedger.$inferInsert = { id:createUuidV7(), movementType:m.type, variant:r.variant, quantity:m.quantity, poolId:m.poolId, skuId:m.skuId,
        allocationId:a?.id ?? null, locationId:location?.id ?? null, shelfDelta:d[0]!,stagingDelta:d[1]!,allocTotalDelta:d[2]!,allocatedDelta:d[3]!,reservedDelta:d[4]!,committedDelta:d[5]!,
        ownerEntityId:pool.ownerEntityId,sellerEntityId:store?.sellerEntityId ?? null,storefrontId:store?.id ?? null,relationshipMode:mode,crossEntity,
        documentRef:m.documentRef ?? null,reason:m.reason ?? null,actorUserId:user.id,correlationId:ctx.correlationId,
        reservationId:m.reservationId ?? null,fulfillmentRequestId:m.fulfillmentRequestId ?? null,paymentMethod:(m.type === "RESERVE" ? m.paymentMethod : lineState(history,m).payment) ?? null,
        countLineId:m.approvedCountLineId ?? null,scanConfirmed:m.scanConfirmed ?? false };
      if (m.type === "COMMIT") {
        const mappings = await ctx.tx.select().from(accountingMappings).where(and(eq(accountingMappings.skuId,m.skuId),inArray(accountingMappings.legalEntityId,[pool.ownerEntityId,store!.sellerEntityId])))
          .orderBy(desc(accountingMappings.active),desc(accountingMappings.updatedAt),desc(accountingMappings.id));
        const seller = mappings.find((v)=>v.legalEntityId === store!.sellerEntityId), owner = mappings.find((v)=>v.legalEntityId === pool.ownerEntityId);
        row.sellerAccountingItemId=seller?.accountingItemId ?? null; row.sellerAccountingName=seller?.accountingName ?? null;
        row.ownerAccountingItemId=owner?.accountingItemId ?? null; row.ownerAccountingName=owner?.accountingName ?? null;
      }
      effects.push({m,rule:r,pool,allocation:a,store,mode,crossEntity,row});
      history.push({...row,createdAt:new Date()} as LedgerRow);
    }
    const rows: LedgerRow[] = [];
    for (const effect of effects.filter((e)=>e.rule.precondition.startsWith("LOST"))) await proofs.cancelLostFulfillmentLine!(ctx,effect.m);
    // Apply each complete row's pool+allocation delta; deferred DB sum checks see the final batch.
    for (const effect of effects) {
      const { row, m } = effect;
      const [inserted] = await ctx.tx.insert(stockLedger).values(row).returning();
      rows.push(inserted!);
      await ctx.recordAudit({action:"STOCK_MOVEMENT",entityType:"stock_ledger",entityId:row.id!,after:inserted,reason:m.reason,externalDocumentRef:m.documentRef});
      await ctx.emitOutboxEvent({eventType:"STOCK_CHANGED",storefrontId:effect.store?.id,aggregateType:"sku",aggregateId:m.skuId,
        payload:{ledgerId:row.id,type:m.type,poolId:m.poolId,skuId:m.skuId,allocationId:m.allocationId,quantity:m.quantity,unitLost:!!m.cancelLostLine},consumers:effect.store ? ["storefront:"+effect.store.id] : ["inventory"]});
    }
    for (const [key,p] of commitmentOnly ? [] : pb) {
      const [poolId,skuId]=key.split(":");
      await ctx.tx.update(poolSkuBalances).set({...p,updatedAt:new Date()}).where(and(eq(poolSkuBalances.poolId,poolId!),eq(poolSkuBalances.skuId,skuId!)));
    }
    for (const [allocationId,b] of ab) if (!commitmentOnly || allocationIds.includes(allocationId)) {
      await ctx.tx.update(allocationBalances).set({...b,updatedAt:new Date()}).where(eq(allocationBalances.allocationId,allocationId));
    }
    return {status:"APPLIED" as const,rows};
  });
}
