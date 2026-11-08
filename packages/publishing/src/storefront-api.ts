import { and, asc, eq, gt, sql } from "drizzle-orm";
import { skus, storefrontListings, type DbExecutor } from "@khidi/db";
import { AppError } from "@khidi/shared";
import { storefrontApiHost } from "@khidi/shared/hosts";
import { getStorefrontProductProjection } from "./index.ts";

/** Projection of one public product. Never return component, accounting or supplier metadata. */
export async function storefrontProduct(db:DbExecutor,storefrontId:string,skuId:string,locale="ka") {
  const [row]=await db.select({id:skus.id}).from(skus).innerJoin(storefrontListings,eq(storefrontListings.skuId,skus.id))
    .where(and(eq(skus.id,skuId),eq(storefrontListings.storefrontId,storefrontId)));
  if(!row) throw new AppError("NOT_FOUND","Product not found.");
  const projection=await getStorefrontProductProjection(db,{skuId,storefrontId,locale});
  if(!projection) throw new AppError("NOT_FOUND","Product not found.");
  const {blockingReasons,...publicFields}=projection;
  const text=JSON.stringify(publicFields),api=storefrontApiHost();
  const hosts=["app.khidi.app","api.khidi.app",api,process.env.HUB_NEUTRAL_DOMAIN].filter((v):v is string=>!!v);
  if(/KH-\d+|khidi:\/\//i.test(text) || hosts.some((h)=>text.toLowerCase().includes(h.toLowerCase()))) throw new AppError("NOT_FOUND","Product not found.");
  return {skuId,...publicFields,blockingReasons:projection.sellable ? [] : ["NOT_SELLABLE"]};
}
export async function storefrontProducts(db:DbExecutor,storefrontId:string,input:{locale:string;updated_since?:string;cursor?:string;limit:number}) {
  // Component events also invalidate their public bundle's availability, within this storefront.
  const since=input.updated_since ? new Date(input.updated_since) : undefined;
  const rows=await db.select({id:skus.id}).from(skus).innerJoin(storefrontListings,eq(storefrontListings.skuId,skus.id))
    .where(and(eq(storefrontListings.storefrontId,storefrontId),input.cursor ? gt(skus.id,input.cursor) : undefined,since ? sql`(
      ${skus.updatedAt}>=${since} OR EXISTS(SELECT 1 FROM outbox_events e WHERE e.created_at>=${since} AND (e.storefront_id IS NULL OR e.storefront_id=${storefrontId})
      AND (e.aggregate_id=${skus.id} OR e.aggregate_id IN(SELECT component_sku_id FROM bundle_components WHERE bundle_sku_id=${skus.id})
        OR e.aggregate_id IN(SELECT id FROM product_images WHERE sku_id=${skus.id})
        OR e.aggregate_id IN(SELECT id FROM image_publications WHERE sku_id=${skus.id})
        OR e.aggregate_id IN(SELECT id FROM storefront_listings WHERE sku_id=${skus.id} AND storefront_id=${storefrontId}))))` : undefined))
    .orderBy(asc(skus.id)).limit(input.limit);
  const items=[];
  for(const row of rows) {
    try {items.push(await storefrontProduct(db,storefrontId,row.id,input.locale));}
    catch(error) {if(!(error instanceof AppError) || error.code!=="NOT_FOUND")throw error;if(since)items.push({skuId:row.id,unpublished:true as const});}
  }
  return {items,nextCursor:rows.length===input.limit ? rows.at(-1)!.id : null};
}
