import { sql } from "drizzle-orm";
import type { DbExecutor } from "@khidi/db";
import { AppError } from "@khidi/shared";
import { z } from "zod";
import { assertReportAccess } from "./access.ts";
const day=z.string().max(10).regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v);
export const reportRangeSchema=z.object({entityId:z.string().max(36).uuid(),from:day,to:day,availability:z.boolean().default(false)}).strict()
 .refine(v=>v.from<=v.to&&Date.parse(v.to)-Date.parse(v.from)<=366*86400000);
export type ReportRange=z.input<typeof reportRangeSchema>;
export type MovementRow={
 id:string;kind:string;variant:string;date:string;saleDate:string|null;exitDate:string|null;storefront:string|null;storefrontId:string|null;orderRef:string|null;
 sku:string;itemSku:string|null;quantity:number;itemQuantity:number|null;lineQuantity:number|null;itemId:string|null;bundle:boolean;
 unitPrice:string|null;currency:string|null;vat:boolean|null;accountingId:string|null;accountingName:string|null;ownerId:string;sellerId:string|null;
 provenance:string;document:string|null;reason:string|null;relationship:string|null;correlation:string;
};
export type ReportLine=MovementRow&{rowKind:"ITEM"|"BUNDLE"|"COMPONENT"|"MOVEMENT";totalMinor:string|null;allocationUndetermined:boolean;
 componentSnapshots?:{sku:string;accountingId:string|null;accountingName:string|null}[]};
export type MovementReport={range:z.output<typeof reportRangeSchema>;seller:ReportLine[];owner:ReportLine[];transfers:ReportLine[];other:ReportLine[];availability:ReportLine[];
 totals:{view:"seller"|"owner";storefrontId:string|null;storefront:string|null;currency:string;totalMinor:string}[]};
const iso=(v:unknown)=>v instanceof Date?v.toISOString():String(v);
/** Pure grouping: only a bundle header carries a price. No invented component allocation. */
export function reportLines(rows:MovementRow[],ownerView=false,ownerEntityId?:string):ReportLine[] {
 const result:ReportLine[]=[],groups=new Map<string,MovementRow[]>();
 for(const row of rows) {
  const key=row.bundle?row.itemId+":"+row.kind+":"+row.correlation:row.id;
  groups.set(key,[...(groups.get(key)??[]),row]);
 }
 for(const group of groups.values()) {
  const first=group[0]!,sign=["COMMIT_RELEASE","BUNDLE_CANCELLED"].includes(first.kind)?-1:1;
  if(first.bundle&&first.kind==="COMMIT_RELEASE") {
   for(const row of group)result.push({...row,quantity:-row.quantity,unitPrice:null,rowKind:"COMPONENT",totalMinor:null,allocationUndetermined:false});
   continue;
  }
  const units=first.itemQuantity&&first.lineQuantity?first.quantity*first.itemQuantity/first.lineQuantity:first.quantity;
  if(!Number.isSafeInteger(units))throw new AppError("PRECONDITION_FAILED","Non-integral bundle report quantity.");
  const mixed=first.bundle&&new Set(group.map(r=>r.ownerId)).size>1;
  const total=first.unitPrice===null?null:(BigInt(first.unitPrice)*BigInt(units)*BigInt(sign)).toString();
  if(first.bundle) {
   result.push({...first,id:"bundle:"+first.id,sku:first.itemSku!,quantity:units*sign,accountingId:null,accountingName:null,
    rowKind:"BUNDLE",totalMinor:ownerView&&mixed?null:total,allocationUndetermined:mixed,
    componentSnapshots:group.filter(r=>!ownerView||!ownerEntityId||r.ownerId===ownerEntityId).map(r=>({sku:r.sku,accountingId:r.accountingId,accountingName:r.accountingName}))});
   // Cancellation is a single money correction. Quantities come only from actual
   // component COMMIT_RELEASE rows, possibly on later days.
   if(first.kind!=="BUNDLE_CANCELLED")for(const row of group)result.push({...row,quantity:row.quantity*sign,unitPrice:null,rowKind:"COMPONENT",totalMinor:null,allocationUndetermined:mixed});
  }else result.push({...first,quantity:first.quantity*sign,rowKind:first.itemId?"ITEM":"MOVEMENT",totalMinor:total,allocationUndetermined:false});
 }
 return result;
}
/** Internal worker entry point; no current accounting mappings or current prices are read. */
export async function buildMovementReport(db:DbExecutor,raw:ReportRange):Promise<MovementReport> {
 const range=reportRangeSchema.parse(raw);
 return db.transaction(async tx=>{
  const result=await tx.execute(sql`
   WITH bounds AS (SELECT ${range.from}::date::timestamp AT TIME ZONE 'Asia/Tbilisi' AS lo,
     (${range.to}::date+1)::timestamp AT TIME ZONE 'Asia/Tbilisi' AS hi),
   events AS (
    SELECT l.*,l.created_at AS report_at,false AS bundle_cancel FROM stock_ledger l
    UNION ALL
    SELECT c.*,decision.created_at AS report_at,true AS bundle_cancel
    FROM stock_ledger c JOIN reservation_lines line ON line.id=c.reservation_line_id
    JOIN reservation_items item ON item.id=line.item_id AND item.composed_bundle
    JOIN reservations head ON head.id=c.reservation_id AND head.fulfillment_mode='CONTROLLED_FULFILLMENT'
    JOIN fulfillment_requests request ON request.reservation_id=head.id
    JOIN LATERAL (SELECT history.created_at FROM fulfillment_history history
     WHERE history.fulfillment_request_id=request.id AND history.to_status='CANCELLED' AND history.action='FULFILLMENT_CANCELLED'
     ORDER BY history.created_at,history.id LIMIT 1) decision ON true
    WHERE c.movement_type='COMMIT'
   )
   SELECT l.id,CASE WHEN l.bundle_cancel THEN 'BUNDLE_CANCELLED' ELSE l.movement_type END AS kind,l.variant,l.report_at AS date,c.created_at AS "saleDate",h.created_at AS "exitDate",
    s.name AS storefront,l.storefront_id AS "storefrontId",r.storefront_order_ref AS "orderRef",
    k.internal_sku AS sku,ik.internal_sku AS "itemSku",l.quantity,i.quantity AS "itemQuantity",rl.quantity AS "lineQuantity",i.id AS "itemId",
    coalesce(i.composed_bundle,false) AS bundle,i.final_unit_price_minor::text AS "unitPrice",i.currency,i.vat_included AS vat,
    c.seller_accounting_item_id AS "sellerAccountingId",c.seller_accounting_name AS "sellerAccountingName",
    c.owner_accounting_item_id AS "ownerAccountingId",c.owner_accounting_name AS "ownerAccountingName",
    l.owner_entity_id AS "ownerId",l.seller_entity_id AS "sellerId",
    coalesce((SELECT string_agg(DISTINCT u.method,',' ORDER BY u.method) FROM unit_confirmations u
      WHERE u.reservation_line_id=l.reservation_line_id AND u.action='PICK_TO_STAGING' AND u.created_at<b.hi),'') AS provenance,
    l.document_ref AS document,l.reason,l.relationship_mode AS relationship,l.correlation_id AS correlation
   FROM events l CROSS JOIN bounds b JOIN skus k ON k.id=l.sku_id
   LEFT JOIN reservation_lines rl ON rl.id=l.reservation_line_id
   LEFT JOIN reservation_items i ON i.id=rl.item_id LEFT JOIN skus ik ON ik.id=i.sku_id
   LEFT JOIN reservations r ON r.id=l.reservation_id LEFT JOIN storefronts s ON s.id=l.storefront_id
   LEFT JOIN LATERAL (SELECT c.* FROM stock_ledger c WHERE c.reservation_line_id=l.reservation_line_id AND c.movement_type='COMMIT' ORDER BY c.created_at,c.id LIMIT 1) c ON true
   LEFT JOIN LATERAL (SELECT h.created_at FROM stock_ledger h WHERE h.reservation_line_id=l.reservation_line_id AND h.movement_type='HANDOVER_OUT' AND h.created_at<b.hi ORDER BY h.created_at,h.id LIMIT 1) h ON true
   WHERE l.report_at>=b.lo AND l.report_at<b.hi AND (l.owner_entity_id=${range.entityId}::uuid OR l.seller_entity_id=${range.entityId}::uuid
     OR (i.composed_bundle AND EXISTS(SELECT 1 FROM reservation_lines peer JOIN stock_ledger pl ON pl.reservation_line_id=peer.id
       WHERE peer.item_id=i.id AND pl.movement_type=l.movement_type AND pl.correlation_id=l.correlation_id AND pl.owner_entity_id=${range.entityId}::uuid)))
   ORDER BY l.report_at,l.id LIMIT 100001
  `);
  if(result.rows.length>100000)throw new AppError("PRECONDITION_FAILED","Report is too large; select a shorter period.");
  const rawRows=result.rows as unknown as (MovementRow&{sellerAccountingId:string|null;sellerAccountingName:string|null;ownerAccountingId:string|null;ownerAccountingName:string|null})[];
  const rows=rawRows.map(row=>({...row,date:iso(row.date),saleDate:row.saleDate?iso(row.saleDate):null,exitDate:row.exitDate?iso(row.exitDate):null}));
  const accounting=(r:typeof rows[number],view:"seller"|"owner"|"none"):MovementRow=>{
   const {sellerAccountingId,sellerAccountingName,ownerAccountingId,ownerAccountingName,...movement}=r;
   return {...movement,accountingId:view==="seller"?sellerAccountingId:view==="owner"?ownerAccountingId:null,
    accountingName:view==="seller"?sellerAccountingName:view==="owner"?ownerAccountingName:null};
  };
  const seller=reportLines(rows.filter(r=>r.sellerId===range.entityId&&["COMMIT","COMMIT_RELEASE","BUNDLE_CANCELLED"].includes(r.kind)).map(r=>accounting(r,"seller")));
  // Keep all components for mixed-owner detection before applying the owner's row scope.
  const owner=reportLines(rows.filter(r=>r.kind==="HANDOVER_OUT").map(r=>accounting(r,"owner")),true,range.entityId).filter(r=>r.ownerId===range.entityId||r.rowKind==="BUNDLE"&&r.allocationUndetermined);
  const plain=(items:typeof rows)=>reportLines(items.map(r=>({...accounting(r,"none"),itemId:null,unitPrice:null,bundle:false})));
  const transfers=plain(rows.filter(r=>r.ownerId===range.entityId&&r.variant==="CROSS_POOL"&&["TRANSFER_OUT","TRANSFER_IN"].includes(r.kind)));
  const availability=range.availability?plain(rows.filter(r=>r.ownerId===range.entityId&&["STOCK_IN","STOCK_OUT"].includes(r.kind)&&r.reason==="availability set")):[];
  const other=plain(rows.filter(r=>r.ownerId===range.entityId&&["WRITE_OFF","ADJUSTMENT","STOCK_IN","STOCK_OUT"].includes(r.kind)&&r.reason!=="availability set"));
  const totals:MovementReport["totals"]=[],sums=new Map<string,MovementReport["totals"][number]>();
  for(const [view,lines] of [["seller",seller],["owner",owner]] as const)for(const l of lines)if(l.totalMinor!==null&&l.currency) {
   const key=view+":"+l.storefrontId+":"+l.currency,previous=sums.get(key);
   sums.set(key,{view,storefrontId:l.storefrontId,storefront:l.storefront,currency:l.currency,totalMinor:(BigInt(previous?.totalMinor??"0")+BigInt(l.totalMinor)).toString()});
  }
  totals.push(...sums.values());return {range,seller,owner,transfers,other,availability,totals};
 },{isolationLevel:"repeatable read",accessMode:"read only"});
}
export async function movementReport(db:DbExecutor,userId:string,raw:ReportRange) {
 const range=reportRangeSchema.parse(raw);await assertReportAccess(db,userId,range.entityId);return buildMovementReport(db,range);
}
