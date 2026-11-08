import { readBoundedJson } from "../../../lib/request-body.ts";
import { NextResponse } from "next/server";
import { getDb } from "@khidi/db";
import { executeIdempotent } from "@khidi/domain";
import { setEntityRelationship } from "@khidi/entities";
import { AppError } from "@khidi/shared";
import { t, type TranslationKey } from "@khidi/i18n";
import { applyAdvancedStockOperation, advancedStockSchema, configureAvailabilityPool, createStockPool, inventoryAccess, listInventoryActions, listInventoryWorkspace,
  previewOnlineAvailability, requestReplenishment, respondToReplenishment, setAllocationMinimum, setOnlineAvailability,
  type AvailabilityTarget, type SetAvailabilityInput, type AdvancedStockInput } from "@khidi/inventory";
import { getCurrentPrincipal } from "../../../lib/session.ts";
import { assertSecurityOrigin } from "../../../lib/security-origin.ts";
import { scanningErrorResponse } from "../../../lib/scanning-response.ts";

const explanations:Record<string,TranslationKey>={
  AVAILABILITY_POOL_REQUIRED:"inventory.error.AVAILABILITY_POOL_REQUIRED",AVAILABILITY_POOL_INACTIVE:"inventory.error.AVAILABILITY_POOL_INACTIVE",
  AVAILABILITY_CONSIGNMENT_REQUIRED:"inventory.error.AVAILABILITY_CONSIGNMENT_REQUIRED",AVAILABILITY_POOL_NOT_DRAINED:"inventory.error.AVAILABILITY_POOL_NOT_DRAINED",RELATIONSHIP_POOL_BINDING:"inventory.error.RELATIONSHIP_POOL_BINDING",
  AVAILABILITY_MULTIPLE_POOLS:"inventory.error.AVAILABILITY_MULTIPLE_POOLS",AVAILABILITY_SKU_ARCHIVED:"inventory.error.AVAILABILITY_SKU_ARCHIVED",
  AVAILABILITY_TOO_LARGE:"inventory.error.AVAILABILITY_TOO_LARGE",REPLENISHMENT_NOT_OPEN:"inventory.error.REPLENISHMENT_NOT_OPEN",RELATIONSHIP_HELD_UNITS:"inventory.error.RELATIONSHIP_HELD_UNITS"
};
function errorResponse(error:unknown) {
  if(error instanceof AppError && typeof error.details?.blockedReason==="string" && explanations[error.details.blockedReason]) {
    return NextResponse.json({error:t(explanations[error.details.blockedReason]!),code:error.code,blockedReason:error.details.blockedReason,blockedAllocations:error.details.allocations},{status:412});
  }
  return scanningErrorResponse(error);
}
export async function GET(request:Request) {
  try {
    const principal=await getCurrentPrincipal();
    if(!principal) throw new AppError("UNAUTHORIZED","Authentication required.");
    if(!["ADMIN","STOCK_MANAGER"].includes(principal.role)) throw new AppError("FORBIDDEN","Inventory access denied.");
    const db=getDb(),actor={userId:principal.userId},storefrontId=new URL(request.url).searchParams.get("storefrontId");
    await inventoryAccess(db,actor);
    if(!storefrontId) return NextResponse.json(await listInventoryActions(db,actor),{headers:{"Cache-Control":"private, no-store"}});
    if(!/^[0-9a-f-]{36}$/i.test(storefrontId)) throw new AppError("VALIDATION_ERROR","Invalid storefront.");
    const workspace=await listInventoryWorkspace(db,actor,storefrontId);
    return NextResponse.json({rows:workspace.rows,poolId:workspace.pool?.id??null},{headers:{"Cache-Control":"private, no-store"}});
  }catch(error){return errorResponse(error);}
}
export async function POST(request:Request) {
  try {
    const principal=await getCurrentPrincipal();
    if(!principal) throw new AppError("UNAUTHORIZED","Authentication required.");
    if(!["ADMIN","STOCK_MANAGER"].includes(principal.role)) throw new AppError("FORBIDDEN","Inventory access denied.");
    assertSecurityOrigin(request);
    const db=getDb(),actor={userId:principal.userId};await inventoryAccess(db,actor);
    const body=await readBoundedJson(request) as {action?:string;input?:Record<string,unknown>};
    if(!body.input || typeof body.input!=="object") throw new AppError("VALIDATION_ERROR","Input required.");
    const input=body.input;
    if(body.action==="preview") return NextResponse.json({preview:await previewOnlineAvailability(db,actor,input as AvailabilityTarget)});
    if(body.action==="advanced-preview") {
      await inventoryAccess(db,actor,undefined,true);
      const parsed=advancedStockSchema.safeParse(input);
      if(!parsed.success) throw new AppError("VALIDATION_ERROR","Invalid operation.");
      return NextResponse.json({preview:parsed.data});
    }
    const key=request.headers.get("Idempotency-Key")??"";
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) throw new AppError("VALIDATION_ERROR","Request key required.");
    if(body.action==="set") {
      const result=await setOnlineAvailability(db,actor,{...input,idempotencyKey:key} as SetAvailabilityInput);
      return NextResponse.json(result.body,{status:result.status});
    }
    const result=await executeIdempotent(db,{scope:"m8:inventory:"+principal.userId,idempotencyKey:key,payload:body},async(tx)=>{
      let outcome:unknown;
      if(body.action==="configure-pool") outcome=await configureAvailabilityPool(tx,actor,input as {storefrontId:string;poolId:string});
      else if(body.action==="create-pool") outcome=await createStockPool(tx,actor,input as {ownerEntityId:string;name:string});
      else if(body.action==="advanced") outcome=await applyAdvancedStockOperation(tx,actor,input as AdvancedStockInput);
      else if(body.action==="minimum") outcome=await setAllocationMinimum(tx,actor,input as {allocationId:string;minimum:number});
      else if(body.action==="request") outcome=await requestReplenishment(tx,actor,input as {allocationId:string;quantity:number;note?:string});
      else if(body.action==="respond") outcome=await respondToReplenishment(tx,actor,input as {requestId:string;status:"ACKNOWLEDGED"|"DECLINED";note?:string});
      else if(body.action==="relationship") {
        await inventoryAccess(tx,actor,undefined,true);
        outcome=await setEntityRelationship(tx,actor,input as {fromEntityId:string;toEntityId:string;mode:"CONSIGNMENT"|"PURCHASE"});
      }else throw new AppError("VALIDATION_ERROR","Unknown inventory action.");
      return {status:200,body:{result:outcome}};
    });
    return NextResponse.json(result.body,{status:result.status});
  }catch(error){return errorResponse(error);}
}
