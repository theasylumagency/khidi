import { and, eq } from "drizzle-orm";
import { workflowCommands, type DbExecutor } from "@khidi/db";
import { executeIdempotent, withDomainTransaction, type DomainTransactionContext } from "@khidi/domain";
import { authorizeWorkflowPrincipal, workflowActor, type WorkflowPrincipal } from "@khidi/inventory/workflow";
import { AppError, createUuidV7, sha256Hex } from "@khidi/shared";

/** Durable business receipt outlives the generic idempotency cache and API-key rotation. */
export async function workflowCommand<T extends Record<string,unknown>>(db:DbExecutor,p:WorkflowPrincipal,action:string,key:string,payload:unknown,
  handler:(ctx:DomainTransactionContext)=>Promise<{status:number;body:T}>) {
  if(!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(key)) throw new AppError("VALIDATION_ERROR","An idempotency UUID is required.");
  await authorizeWorkflowPrincipal(db,p);
  const identity=p.type==="STOREFRONT_SERVICE" ? p.storefrontId : p.type==="USER" ? p.userId : p.type==="SYSTEM_JOB" ? p.jobId : p.reservationId;
  const scope="order:"+identity+":"+action,requestHash=sha256Hex(JSON.stringify(payload));
  return executeIdempotent(db,{scope,idempotencyKey:key,payload},async(tx)=>{
    const [receipt]=await tx.select().from(workflowCommands).where(and(eq(workflowCommands.scope,scope),eq(workflowCommands.requestKey,key)));
    if(receipt) {
      if(receipt.requestHash!==requestHash) throw new AppError("IDEMPOTENCY_CONFLICT","This request key was used for another payload.");
      return {status:receipt.responseStatus,body:receipt.responseJson as T};
    }
    return withDomainTransaction(tx,workflowActor(p),async(ctx)=>{
      await authorizeWorkflowPrincipal(ctx.tx,p);
      const result=await handler(ctx);
      await ctx.tx.insert(workflowCommands).values({id:createUuidV7(),scope,requestKey:key,requestHash,responseStatus:result.status,responseJson:result.body});
      return result;
    });
  });
}
