import { redirect } from "next/navigation";
import { getDb } from "@khidi/db";
import { listStorefronts } from "@khidi/entities";
import { inventoryAccess, listInventoryWorkspace, listInventoryActions, getAdvancedInventoryBalances } from "@khidi/inventory";
import { t } from "@khidi/i18n";
import { requirePageAuth } from "../../lib/session.ts";
import { InventoryWorkspace } from "../../components/inventory-workspace.tsx";
import { InventoryAdvanced } from "../../components/inventory-advanced.tsx";
import { InventoryReplenishment } from "../../components/inventory-replenishment.tsx";

export const dynamic="force-dynamic";
export default async function InventoryPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const principal=await requirePageAuth({allowedRoles:["ADMIN","STOCK_MANAGER"]});
  const db=getDb(),actor={userId:principal.userId},access=await inventoryAccess(db,actor);
  const [allStores,pools,query,actions]=await Promise.all([listStorefronts(db),db.query.stockPools.findMany(),searchParams,listInventoryActions(db,actor)]);
  const stores=allStores.filter((s)=>access.user.role==="ADMIN" || access.ownerIds.includes(s.sellerEntityId) && pools.some((p)=>p.id===s.availabilityPoolId&&p.ownerEntityId===s.sellerEntityId));
  if(!stores.length) return <section><h1>{t("inventory.title")}</h1><p>{t("inventory.pool_prompt")}</p></section>;
  const store=stores.find((s)=>s.id===query.storefrontId)??stores[0]!;
  if(query.storefrontId && !stores.some((s)=>s.id===query.storefrontId)) redirect("/inventory");
  const workspace=await listInventoryWorkspace(db,actor,store.id);
  const entities=principal.role==="ADMIN"?await db.query.legalEntities.findMany():[];
  const advancedBalances=principal.role==="ADMIN"?await getAdvancedInventoryBalances(db,actor):{pools:[],assigned:[]};
  return <section className="office-login">
    <h1>{t("inventory.title")}</h1>
    <form><label>{t("inventory.store")} <select name="storefrontId" defaultValue={store.id}>{stores.map((s)=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label> <button>{t("inventory.confirm")}</button></form>
    {workspace.pool?<><p>{t("inventory.pool")}: {workspace.pool.name}</p><InventoryWorkspace key={store.id+":"+(typeof query.skuId==="string"?query.skuId:"")} initialSearch={workspace.rows.find((r)=>r.skuId===query.skuId)?.code} storefrontId={store.id} rows={workspace.rows} requests={actions.requests.map((r)=>({id:r.request.id,allocationId:r.allocation.id,status:r.request.status}))}/></>:<p>{t("inventory.pool_prompt")}</p>}
    <InventoryReplenishment requests={actions.requests.filter((r)=>r.allocation.storefrontId===store.id).map((r)=>({id:r.request.id,skuId:r.allocation.skuId,storefrontId:r.allocation.storefrontId,code:r.code,storeName:r.storeName,quantity:r.request.requestedQuantity,status:r.request.status}))}/>
    {principal.role==="ADMIN"?<InventoryAdvanced storefrontId={store.id} configured={!!store.availabilityPoolId} balances={advancedBalances} pools={pools.filter((p)=>p.active).map((p)=>({id:p.id,name:p.name}))}
      stores={allStores.map((s)=>({id:s.id,name:s.name}))} entities={entities.filter((e)=>e.active).map((e)=>({id:e.id,name:e.legalName}))} products={workspace.rows.map((p)=>({id:p.skuId,name:p.code+" · "+p.name}))}/>:null}
  </section>;
}
