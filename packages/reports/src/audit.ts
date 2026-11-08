import { and,desc,eq,lt,sql } from "drizzle-orm";
import { auditLogs,legalEntities,users,type DbExecutor } from "@khidi/db";
import { AppError } from "@khidi/shared";
import { z } from "zod";
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v);
const filterSchema=z.object({from:date.optional(),to:date.optional(),actorType:z.enum(["USER","STOREFRONT_SERVICE","SYSTEM_JOB","SYSTEM_WORKFLOW"]).optional(),
 actorId:z.string().min(1).max(200).optional(),entityType:z.string().min(1).max(100).optional(),entityId:z.string().min(1).max(200).optional(),
 entityIdScope:z.string().uuid().optional(),action:z.string().min(1).max(100).optional(),correlationId:z.string().min(1).max(200).optional(),cursor:z.string().uuid().optional()}).strict()
 .refine(v=>!v.from||!v.to||v.from<=v.to);
export type AuditFilter=z.input<typeof filterSchema>;
const secretKey=/password|passwd|secret|totp|recovery|token|credential|public.?key|private.?key|key.?hash|key.?material|raw.?key|p256dh|authorization|cookie|vapid|^(?:key|auth|endpoint|apiKey)$|pin(?:$|.?hash|.?salt|.?code)/i;
function safeText(value:string) {
 return value.replace(/v1:[a-f0-9]+:[a-f0-9]+:[a-f0-9]+/gi,"[REDACTED]")
  .replace(/(?:sf|khidi_session|khidi_device)_[A-Za-z0-9._-]+/g,"[REDACTED]")
  .replace(/\b(?:Bearer|Basic)\s+\S+/gi,"[REDACTED]")
  .replace(/\$2[aby]\$\S+|scrypt:[^\s]+/g,"[REDACTED]")
  .replace(/((?:password|secret|token|totp|pin)\s*[:=]\s*)[^\s,;]+/gi,"$1[REDACTED]")
  .replace(/(https?:\/\/)[^/\s@]+@/g,"$1[REDACTED]@")
  .replace(/[A-Za-z0-9_+\/-]{32,}={0,2}/g,v=>/^(?:cor_)?[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v)?v:"[REDACTED]");
}
/** Redact before the transport/React payload is produced, not only while rendering. */
export function redactAudit(value:unknown,depth=0):unknown {
 if(depth>20)return "[REDACTED]";
 if(typeof value==="string")return safeText(value);
 if(Array.isArray(value))return value.map(v=>redactAudit(v,depth+1));
 if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).map(([key,v])=>[key,secretKey.test(key)?"[REDACTED]":redactAudit(v,depth+1)]));
 return value;
}
export async function historyUser(db:DbExecutor,userId:string) {
 const [u]=await db.select({id:users.id,role:users.role}).from(users).where(and(eq(users.id,userId),eq(users.active,true)));
 if(!u||!["ADMIN","STOCK_MANAGER"].includes(u.role))throw new AppError("FORBIDDEN","History access denied.");return u;
}
export async function historyEntities(db:DbExecutor,userId:string) {
 const u=await historyUser(db,userId);
 return db.select({id:legalEntities.id,name:legalEntities.legalName}).from(legalEntities).where(u.role==="ADMIN"?undefined:
  sql`EXISTS(SELECT 1 FROM user_entity_memberships m WHERE m.user_id=${userId} AND m.legal_entity_id=${legalEntities.id})`);
}
export async function auditHistory(db:DbExecutor,userId:string,raw:AuditFilter={}) {
 if((await historyUser(db,userId)).role!=="ADMIN")throw new AppError("FORBIDDEN","Admin audit access required.");
 const q=filterSchema.parse(raw);
 const rows=await db.select().from(auditLogs).where(and(
  q.from?sql`${auditLogs.createdAt}>=${q.from}::date::timestamp AT TIME ZONE 'Asia/Tbilisi'`:undefined,
  q.to?sql`${auditLogs.createdAt}<(${q.to}::date+1)::timestamp AT TIME ZONE 'Asia/Tbilisi'`:undefined,
  q.actorType?sql`coalesce(${auditLogs.actorType},CASE WHEN ${auditLogs.actorUserId} IS NOT NULL THEN 'USER' END)=${q.actorType}`:undefined,
  q.actorId?sql`coalesce(${auditLogs.actorId},${auditLogs.actorUserId}::text)=${q.actorId}`:undefined,
  q.entityType?eq(auditLogs.entityType,q.entityType):undefined,q.entityId?eq(auditLogs.entityId,q.entityId):undefined,
  q.entityIdScope?sql`EXISTS(SELECT 1 FROM audit_legal_entity_scopes s WHERE s.audit_id=${auditLogs.id} AND s.legal_entity_id=${q.entityIdScope}::uuid)`:undefined,
  q.action?eq(auditLogs.action,q.action):undefined,q.correlationId?eq(auditLogs.correlationId,q.correlationId):undefined,q.cursor?lt(auditLogs.id,q.cursor):undefined
 )).orderBy(desc(auditLogs.id)).limit(51);
 return {rows:rows.slice(0,50).map(r=>({...r,beforeJson:redactAudit(r.beforeJson),afterJson:redactAudit(r.afterJson),reason:r.reason?safeText(r.reason):null,
  externalDocumentRef:r.externalDocumentRef?safeText(r.externalDocumentRef):null,entityId:safeText(r.entityId),action:safeText(r.action)})),
  nextCursor:rows.length>50?rows[49]!.id:null};
}
export async function inventoryHistory(db:DbExecutor,userId:string,raw:AuditFilter={}) {
 await historyUser(db,userId);const q=filterSchema.parse(raw),entities=await historyEntities(db,userId);
 if(q.entityIdScope&&!entities.some(e=>e.id===q.entityIdScope))throw new AppError("FORBIDDEN","Own entity history only.");
 const ids=q.entityIdScope?[q.entityIdScope]:entities.map(e=>e.id);if(!ids.length)return {rows:[],nextCursor:null};
 const result=await db.execute(sql`SELECT l.id,l.created_at AS date,l.movement_type AS movement,l.quantity,k.internal_sku AS sku,
   l.owner_entity_id AS "ownerId",p.name AS pool,l.shelf_delta AS "shelfDelta",l.staging_delta AS "stagingDelta",l.allocated_delta AS "allocatedDelta",
   l.reserved_delta AS "reservedDelta",l.committed_delta AS "committedDelta",l.document_ref AS document,l.reason,l.correlation_id AS correlation
  FROM stock_ledger l JOIN skus k ON k.id=l.sku_id JOIN stock_pools p ON p.id=l.pool_id
  WHERE l.owner_entity_id IN (${sql.join(ids.map(id=>sql`${id}::uuid`),sql`,`)})
   ${q.from?sql`AND l.created_at>=${q.from}::date::timestamp AT TIME ZONE 'Asia/Tbilisi'`:sql``}
   ${q.to?sql`AND l.created_at<(${q.to}::date+1)::timestamp AT TIME ZONE 'Asia/Tbilisi'`:sql``}
   ${q.cursor?sql`AND l.id<${q.cursor}::uuid`:sql``}
  ORDER BY l.id DESC LIMIT 51`);
 const rows=result.rows as {id:string;date:Date|string;movement:string;quantity:number;sku:string;ownerId:string;pool:string;shelfDelta:number;stagingDelta:number;allocatedDelta:number;reservedDelta:number;committedDelta:number;document:string|null;reason:string|null;correlation:string}[];
 return {rows:rows.slice(0,50).map(r=>({...r,document:r.document?safeText(r.document):null,reason:r.reason?safeText(r.reason):null})),nextCursor:rows.length>50?rows[49]!.id:null};
}
