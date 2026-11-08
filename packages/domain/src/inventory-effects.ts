import { sql } from "drizzle-orm";
import { getPostgresError,type DbExecutor } from "@khidi/db";
import { AppError } from "@khidi/shared";

/** Caller holds the SKU lock; the database function locks its pool/allocation balances. */
export async function assertSkuInventoryDrained(tx:DbExecutor,skuId:string) {
  try { await tx.execute(sql`SELECT assert_sku_inventory_drained(${skuId}::uuid)`); }
  catch(error) {
    if(getPostgresError(error)?.message.includes("SKU_INVENTORY_NOT_DRAINED")) throw new AppError("PRECONDITION_FAILED","Source inventory must be fully drained before merge or archive.",{blockedReason:"SKU_INVENTORY_NOT_DRAINED"});
    throw error;
  }
}
