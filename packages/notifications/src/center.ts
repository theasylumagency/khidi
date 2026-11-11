import { and,desc,eq,inArray,isNull,lt,sql } from "drizzle-orm";
import { notifications,notificationPreferences,notificationReceipts,type DbExecutor } from "@khidi/db";
import { executeIdempotent,withDomainTransaction } from "@khidi/domain";
import { AppError } from "@khidi/shared";
import { z } from "zod";
import { receiptAccess,notificationUser } from "./access.ts";
import { notificationLevels } from "./model.ts";
const parse=<T>(schema:z.ZodType<T>,raw:unknown):T=>{const p=schema.safeParse(raw);if(!p.success)throw new AppError("VALIDATION_ERROR","Invalid notification input.");return p.data;};
export async function listNotifications(db:DbExecutor,userId:string,raw:unknown={}) {
 const input=parse(z.object({cursor:z.string().max(36).uuid().optional(),unread:z.boolean().default(false),includeMuted:z.boolean().default(false)}).strict(),raw);
 const rows=await db.select({notification:notifications,readAt:notificationReceipts.readAt,muted:notificationReceipts.muted}).from(notificationReceipts)
  .innerJoin(notifications,eq(notifications.id,notificationReceipts.notificationId)).where(and(await receiptAccess(db,userId),input.cursor?lt(notifications.id,input.cursor):undefined,
   input.unread?isNull(notificationReceipts.readAt):undefined,input.includeMuted?undefined:eq(notificationReceipts.muted,false))).orderBy(desc(notifications.id)).limit(51);
 return {rows:rows.slice(0,50),nextCursor:rows.length>50?rows[49]!.notification.id:null};
}
export async function notificationUnreadCount(db:DbExecutor,userId:string) {
 const [row]=await db.select({count:sql<string>`count(*)`}).from(notificationReceipts).innerJoin(notifications,eq(notifications.id,notificationReceipts.notificationId))
  .where(and(await receiptAccess(db,userId),isNull(notificationReceipts.readAt),eq(notificationReceipts.muted,false)));return Number(row!.count);
}
export async function notificationSettings(db:DbExecutor,userId:string) {
 await notificationUser(db,userId);const preferences=await db.select().from(notificationPreferences).where(eq(notificationPreferences.userId,userId));
 return Object.entries(notificationLevels).filter(([,level])=>level==="INFO").map(([type])=>({type,muted:preferences.some(p=>p.type===type&&p.muted)}));
}
export async function updateNotification(db:DbExecutor,userId:string,key:string,raw:unknown) {
 const input=parse(z.discriminatedUnion("action",[
  z.object({action:z.literal("READ"),notificationId:z.string().max(36).uuid()}).strict(),
  z.object({action:z.literal("MUTE"),type:z.string().max(65536),muted:z.boolean()}).strict()
 ]),raw);
 parse(z.string().max(36).uuid(),key);await notificationUser(db,userId);
 if(input.action==="MUTE"&&notificationLevels[input.type as keyof typeof notificationLevels]!=="INFO")throw new AppError("FORBIDDEN","Only INFO can be muted.");
 return executeIdempotent(db,{scope:"notifications:"+userId,idempotencyKey:key,payload:input},tx=>withDomainTransaction(tx,{userId},async(ctx)=>{
  if(input.action==="READ") {
   const [row]=await ctx.tx.select({id:notifications.id,readAt:notificationReceipts.readAt}).from(notificationReceipts).innerJoin(notifications,eq(notifications.id,notificationReceipts.notificationId))
    .where(and(await receiptAccess(ctx.tx,userId),eq(notifications.id,input.notificationId))).for("update",{of:notificationReceipts});
   if(!row)throw new AppError("NOT_FOUND","Notification not found.");
   if(!row.readAt) {
    await ctx.tx.update(notificationReceipts).set({readAt:new Date()}).where(and(eq(notificationReceipts.notificationId,row.id),eq(notificationReceipts.userId,userId)));
    await ctx.recordAudit({action:"NOTIFICATION_READ",entityType:"notification",entityId:row.id,after:{read:true}});
    await ctx.emitOutboxEvent({eventType:"NOTIFICATION_UPDATED",aggregateType:"notification",aggregateId:row.id,payload:{read:true},consumers:[]});
   }
  }else {
   await ctx.tx.insert(notificationPreferences).values({userId,type:input.type,muted:input.muted}).onConflictDoUpdate({target:[notificationPreferences.userId,notificationPreferences.type],set:{muted:input.muted}});
   const ids=await ctx.tx.select({id:notifications.id}).from(notifications).where(and(eq(notifications.type,input.type),eq(notifications.level,"INFO")));
   if(ids.length)await ctx.tx.update(notificationReceipts).set({muted:input.muted}).where(and(eq(notificationReceipts.userId,userId),inArray(notificationReceipts.notificationId,ids.map(n=>n.id))));
   await ctx.recordAudit({action:"NOTIFICATION_PREFERENCE_CHANGED",entityType:"user",entityId:userId,after:{type:input.type,muted:input.muted}});
   await ctx.emitOutboxEvent({eventType:"NOTIFICATION_UPDATED",aggregateType:"user",aggregateId:userId,payload:{preference:input.type},consumers:[]});
  }return {status:200,body:{ok:true}};
 }));
}
