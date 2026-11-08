import { and, eq } from "drizzle-orm";
import { accountingMappings, allocationBalances, allocations, bundleComponents, skus, stockPools, storefronts, type DbExecutor } from "@khidi/db";

export function selectPrimaryMapping<T extends { active: boolean; isPrimary: boolean }>(rows: T[]): T | null {
  const active=rows.filter((r)=>r.active);
  return active.length === 1 ? active[0]! : active.find((r)=>r.isPrimary) ?? null;
}

/** Internal reserve facts. Never include mappings or component identity in a storefront response. */
export async function getReservationStockFacts(db: DbExecutor, skuId: string, storefrontId: string) {
  const [sku]=await db.select().from(skus).where(eq(skus.id,skuId));
  const [store]=await db.select().from(storefronts).where(eq(storefronts.id,storefrontId));
  const definitions=sku?.isComposedBundle ? await db.select().from(bundleComponents).where(eq(bundleComponents.bundleSkuId,skuId)) : [{componentSkuId:skuId,quantity:1}];
  const blockers: string[]=[];
  if (!store?.active || !store.availabilityPoolId) blockers.push("MISSING_STOREFRONT_ALLOCATION");
  if (!definitions.length) blockers.push("BUNDLE_HAS_NO_COMPONENTS");
  const components=await Promise.all(definitions.map(async(definition)=>{
    const [component]=await db.select().from(skus).where(eq(skus.id,definition.componentSkuId));
    if (!component || component.lifecycleState !== "READY" || component.identityConfidence === "CONFLICT" || component.isComposedBundle)
      blockers.push("COMPONENT_NOT_READY");
    const [allocation]=store?.availabilityPoolId ? await db.select({allocation:allocations,balance:allocationBalances,pool:stockPools}).from(allocations)
      .innerJoin(stockPools,eq(stockPools.id,allocations.poolId)).leftJoin(allocationBalances,eq(allocationBalances.allocationId,allocations.id))
      .where(and(eq(allocations.storefrontId,store.id),eq(allocations.poolId,store.availabilityPoolId),eq(allocations.skuId,definition.componentSkuId),eq(stockPools.active,true))) : [];
    if (!allocation) blockers.push("MISSING_STOREFRONT_ALLOCATION");
    const mappings=await db.select().from(accountingMappings).where(eq(accountingMappings.skuId,definition.componentSkuId));
    const sellerMapping=selectPrimaryMapping(mappings.filter((m)=>m.legalEntityId === store?.sellerEntityId));
    const ownerMapping=selectPrimaryMapping(mappings.filter((m)=>m.legalEntityId === (allocation?.pool.ownerEntityId??store?.sellerEntityId)));
    if (!sellerMapping) blockers.push("MISSING_SELLER_ACCOUNTING_MAPPING");
    if (!ownerMapping) blockers.push("MISSING_OWNER_ACCOUNTING_MAPPING");
    return {skuId:definition.componentSkuId,componentQuantity:definition.quantity,allocationId:allocation?.allocation.id??null,
      poolId:allocation?.pool.id??null,availableToSell:allocation?.balance?.availableToSell??0,sellerMapping,ownerMapping};
  }));
  return {composedBundle:sku?.isComposedBundle??false,components,blockingReasons:[...new Set(blockers)],
    availableToSell:components.length ? Math.min(...components.map((c)=>Math.floor(c.availableToSell/c.componentQuantity))) : 0};
}
