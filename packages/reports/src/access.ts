import { and,eq,sql } from "drizzle-orm";
import { legalEntities,userEntityMemberships,userPermissions,users,type DbExecutor } from "@khidi/db";
import { executeIdempotent,withDomainTransaction } from "@khidi/domain";
import { AppError } from "@khidi/shared";
import { z } from "zod";
export async function reportUser(db:DbExecutor,userId:string) {
 const [u]=await db.select().from(users).where(and(eq(users.id,userId),eq(users.active,true)));
 if(!u||u.role==="WAREHOUSE")throw new AppError("FORBIDDEN","Report access denied.");
 if(u.role!=="ADMIN"&&!(await db.select().from(userPermissions).where(and(eq(userPermissions.userId,userId),eq(userPermissions.permissionKey,"reports.view"))))[0])
  throw new AppError("FORBIDDEN","Report access denied.");
 return u;
}
export async function reportEntities(db:DbExecutor,userId:string) {
 const u=await reportUser(db,userId);
 return db.select().from(legalEntities).where(u.role==="ADMIN"?undefined:sql`EXISTS(SELECT 1 FROM user_entity_memberships m WHERE m.user_id=${userId} AND m.legal_entity_id=${legalEntities.id})`);
}
export async function assertReportAccess(db:DbExecutor,userId:string,entityId:string) {
 if(!(await reportEntities(db,userId)).some(e=>e.id===entityId))throw new AppError("FORBIDDEN","Report entity access denied.");
}
export async function reportAccessSettings(db:DbExecutor,userId:string) {
 if((await reportUser(db,userId)).role!=="ADMIN")throw new AppError("FORBIDDEN","Admin required.");
 return db.select({userId:users.id,name:users.fullName,role:users.role,entityId:legalEntities.id,entity:legalEntities.legalName,
  recipient:userEntityMemberships.isReportRecipient,granted:sql<boolean>`EXISTS(SELECT 1 FROM user_permissions p WHERE p.user_id=${users.id} AND p.permission_key='reports.view')`})
 .from(userEntityMemberships).innerJoin(users,eq(users.id,userEntityMemberships.userId)).innerJoin(legalEntities,eq(legalEntities.id,userEntityMemberships.legalEntityId))
 .where(and(eq(users.active,true),sql`${users.role}<>'WAREHOUSE'`));
}
export async function setReportAccess(db:DbExecutor,adminId:string,key:string,raw:unknown) {
 const input=z.object({userId:z.string().uuid(),entityId:z.string().uuid(),granted:z.boolean(),recipient:z.boolean()}).strict().parse(raw);
 z.string().uuid().parse(key);
 if((await reportUser(db,adminId)).role!=="ADMIN")throw new AppError("FORBIDDEN","Admin required.");
 return executeIdempotent(db,{scope:"report-access:"+adminId,idempotencyKey:key,payload:input},tx=>withDomainTransaction(tx,{userId:adminId},async ctx=>{
  if((await reportUser(ctx.tx,adminId)).role!=="ADMIN")throw new AppError("FORBIDDEN","Admin required.");
  const [u]=await ctx.tx.select().from(users).where(eq(users.id,input.userId)).for("update");
  const [m]=await ctx.tx.select().from(userEntityMemberships).where(and(eq(userEntityMemberships.userId,input.userId),eq(userEntityMemberships.legalEntityId,input.entityId))).for("update");
  if(!u?.active||u.role==="WAREHOUSE"||!m)throw new AppError("FORBIDDEN","Existing non-warehouse entity membership required.");
  const granted=!!(await ctx.tx.select().from(userPermissions).where(and(eq(userPermissions.userId,u.id),eq(userPermissions.permissionKey,"reports.view"))))[0];
  if(input.granted)await ctx.tx.insert(userPermissions).values({userId:u.id,permissionKey:"reports.view",grantedBy:adminId}).onConflictDoNothing();
  else await ctx.tx.delete(userPermissions).where(and(eq(userPermissions.userId,u.id),eq(userPermissions.permissionKey,"reports.view")));
  await ctx.tx.update(userEntityMemberships).set({isReportRecipient:input.recipient}).where(and(eq(userEntityMemberships.userId,u.id),eq(userEntityMemberships.legalEntityId,input.entityId)));
  await ctx.recordAudit({action:"REPORT_ACCESS_CHANGED",entityType:"user",entityId:u.id,before:{legalEntityId:input.entityId,granted,recipient:m.isReportRecipient},after:input});
  await ctx.emitOutboxEvent({eventType:"NOTIFICATION_UPDATED",aggregateType:"user",aggregateId:u.id,payload:{reportAccess:true},consumers:[]});
  return {status:200,body:{ok:true}};
 }));
}
