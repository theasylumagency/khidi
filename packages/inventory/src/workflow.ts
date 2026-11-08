import type { DbExecutor } from "@khidi/db";
import type { StockMovement } from "./types.ts";
import { applyStockMovementBatch, type StockWorkflowProofs } from "./engine-core.ts";
import { workflowActor, type WorkflowPrincipal } from "./workflow-auth.ts";
export { authorizeWorkflowPrincipal, workflowActor, type WorkflowPrincipal } from "./workflow-auth.ts";

/** Not exported from the package index; dependency boundaries restrict callers. */
export function applyWorkflowStockMovements(tx: DbExecutor, principal: WorkflowPrincipal, movements: readonly StockMovement[], proofs: StockWorkflowProofs = {}) {
  return applyStockMovementBatch(tx,workflowActor(principal),movements,proofs,principal);
}
