import { eq } from "drizzle-orm";
import { systemSettings, users, type DbExecutor } from "@khidi/db";
import { acquireDomainLocks } from "@khidi/domain/locking";
import { AppError } from "@khidi/shared";
import { z } from "zod";
import { workflowCommand } from "./commands.ts";
import { fulfillmentModes, parseInput, type FulfillmentMode } from "./contracts.ts";

export const FULFILLMENT_CONFIGURATION_LOCK="fulfillment:configuration";
export async function readFrozenMode(tx:DbExecutor):Promise<FulfillmentMode> {
  const [row]=await tx.select().from(systemSettings).where(eq(systemSettings.key,"fulfillment_mode"));
  const parsed=z.object({mode:z.enum(fulfillmentModes)}).strict().safeParse(row?.valueJson);
  if(!parsed.success) throw new AppError("INVARIANT_VIOLATION","Invalid fulfillment policy configuration.");
  return parsed.data.mode;
}
async function admin(tx:DbExecutor,p:{type:"USER";userId:string}) {
  const [user]=await tx.select().from(users).where(eq(users.id,p.userId));
  if(!user?.active || user.role!=="ADMIN") throw new AppError("FORBIDDEN","Only ADMIN can read or change the fulfillment policy.");
}
export async function getFulfillmentMode(tx:DbExecutor,p:{type:"USER";userId:string}) {await admin(tx,p);return readFrozenMode(tx);}
export async function setFulfillmentMode(tx:DbExecutor,p:{type:"USER";userId:string},key:string,raw:unknown) {
  const input=parseInput(z.object({mode:z.enum(fulfillmentModes)}).strict(),raw);
  return workflowCommand(tx,p,"fulfillment-mode",key,input,async(ctx)=>{
    await admin(ctx.tx,p);
    await acquireDomainLocks(ctx.tx,{advisoryKeys:[FULFILLMENT_CONFIGURATION_LOCK]});
    const before=await readFrozenMode(ctx.tx);
    await ctx.tx.update(systemSettings).set({valueJson:input,updatedBy:p.userId,updatedAt:new Date()}).where(eq(systemSettings.key,"fulfillment_mode"));
    await ctx.recordAudit({action:"FULFILLMENT_MODE_CHANGED",entityType:"system_setting",entityId:"fulfillment_mode",before:{mode:before},after:input});
    await ctx.emitOutboxEvent({eventType:"FULFILLMENT_MODE_CHANGED",aggregateType:"user",aggregateId:p.userId,payload:{key:"fulfillment_mode",...input},consumers:["notifications"]});
    return {status:200,body:input};
  });
}
