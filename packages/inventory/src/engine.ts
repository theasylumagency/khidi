import type { DbExecutor } from "@khidi/db";
import type { DomainActor } from "@khidi/domain";
import type { StockMovement } from "./types.ts";
import { applyStockMovementBatch, type StockWorkflowProofs } from "./engine-core.ts";
export { negativeAdjustmentPlan, type StockWorkflowProofs } from "./engine-core.ts";

/** Staff entry point. Workflow credentials never enter through this API. */
export function applyStockMovements(db:DbExecutor,actor:DomainActor,raw:readonly StockMovement[],proofs:StockWorkflowProofs={}) {
  return applyStockMovementBatch(db,actor,raw,proofs);
}