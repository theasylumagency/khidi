import { expect,it } from "vitest";
import { eq,sql } from "drizzle-orm";
import { getDb,identificationObservations,skuFieldProvenance,skus,productImages,auditLogs } from "@khidi/db";
import { loadPrincipalByUserId } from "@khidi/auth";
import { createSkuDraft,getProductTypeByKey } from "../../products/src/index.ts";
import { setSkuIdentityKind,submitSkuEvidence,reviewSkuEvidence } from "@khidi/evidence";
import { createScanTask,receiveIntake,resolveIntakeReview } from "../../scanning/src/index.ts";
import { createUuidV7 } from "@khidi/shared";
import { reportPhotoAttention,getPhotoCaptureContext } from "./capture.ts";
import { receivePhoto } from "./upload.ts";
import { fixturePhoto } from "./test-fixtures.ts";
import { FilesystemMediaStorage } from "./storage.ts";
import { mkdtemp,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
async function fixture() {
 const db=getDb(),staff=await db.query.users.findMany(),admin=await loadPrincipalByUserId(db,staff.find(u=>u.role==="ADMIN"&&u.active&&!u.totpEnrollmentRequired)!.id),warehouse=await loadPrincipalByUserId(db,staff.find(u=>u.role==="WAREHOUSE"&&u.active&&!u.totpEnrollmentRequired)!.id);
 const type=await getProductTypeByKey(db,"GENERATOR"),sku=await createSkuDraft(db,{userId:admin.userId},{productTypeId:type.id});
 await setSkuIdentityKind(db,{userId:admin.userId},sku.id,"HOUSE_DEFINED","Synthetic document-free generator");
 const task=await createScanTask(db,admin,{idempotencyKey:createUuidV7(),taskType:"INTAKE_UNIQUE",title:"Generator plates",assigneeRole:"WAREHOUSE",photosRequired:true});
 const scan={idempotencyKey:createUuidV7(),userId:warehouse.userId,deviceId:createUuidV7(),scannedAt:new Date().toISOString(),taskId:task.body.id,sourceMode:"TASK",scannedValue:sku.internalSku};
 const intake=await receiveIntake(db,warehouse,scan);
 const report=(outcome:"PLATE_ABSENT"|"LATER",slot="ENGINE_IDENTIFICATION")=>({idempotencyKey:createUuidV7(),userId:warehouse.userId,deviceId:scan.deviceId,capturedAt:new Date().toISOString(),intakeId:intake.body.id,slots:[slot],outcome,reason:outcome==="PLATE_ABSENT"?"PLATE_ABSENT":"CAPTURE_PENDING"});
 return {db,admin,warehouse,sku,intake,scan,report};
}
it("separates two mandatory plates; later is pending, checked absence is attributed NOT_FOUND and never a photo or a fabricated value",async()=>{
 const f=await fixture(),context=await getPhotoCaptureContext(f.db,f.warehouse,{intakeId:f.intake.body.id});
 expect(context.slots.filter(slot=>slot.required&&slot.slot.endsWith("IDENTIFICATION"))).toHaveLength(2);
 await reportPhotoAttention(f.db,f.warehouse,f.report("LATER"));let next=await getPhotoCaptureContext(f.db,f.warehouse,{intakeId:f.intake.body.id});expect(next.missingSlots).toContain("ENGINE_IDENTIFICATION");expect(next.resolvedSlots).toEqual([]);
 const absent=f.report("PLATE_ABSENT");await reportPhotoAttention(f.db,f.warehouse,absent);expect((await reportPhotoAttention(f.db,f.warehouse,absent)).replayed).toBe(true);
 next=await getPhotoCaptureContext(f.db,f.warehouse,{intakeId:f.intake.body.id});expect(next.acceptedSlots).not.toContain("ENGINE_IDENTIFICATION");expect(next.resolvedSlots).toEqual(["ENGINE_IDENTIFICATION"]);expect(next.missingSlots).not.toContain("ENGINE_IDENTIFICATION");
 const field=await f.db.query.skuFieldProvenance.findFirst({where:(r,{and,eq})=>and(eq(r.skuId,f.sku.id),eq(r.fieldName,"engine_model"))});expect(field).toMatchObject({value:null,status:"NOT_FOUND",observationReason:"PLATE_ABSENT",observationId:absent.idempotencyKey,notDeterminableReason:null});
 expect(await f.db.query.identificationObservations.findFirst({where:eq(identificationObservations.id,absent.idempotencyKey)})).toMatchObject({authorId:f.warehouse.userId,deviceId:f.scan.deviceId,reason:"PLATE_ABSENT",status:"NOT_FOUND",value:null});
 expect(await f.db.query.skus.findFirst({where:eq(skus.id,f.sku.id)})).toMatchObject({identityKind:"HOUSE_DEFINED"});
 expect(await f.db.select().from(productImages).where(eq(productImages.intakeId,f.intake.body.id))).toEqual([]);
 expect(await f.db.select().from(auditLogs).where(eq(auditLogs.entityId,absent.idempotencyKey))).toHaveLength(1);
 await expect(f.db.update(identificationObservations).set({outcome:"LATER"}).where(eq(identificationObservations.id,absent.idempotencyKey))).rejects.toThrow();
 await expect(reportPhotoAttention(f.db,f.warehouse,f.report("PLATE_ABSENT","MAIN"))).rejects.toMatchObject({code:"VALIDATION_ERROR"});
});
it("keeps document-verified model readings and clears checked-absence projection when accepted documents supply the field",async()=>{
 const f=await fixture();await reportPhotoAttention(f.db,f.warehouse,f.report("PLATE_ABSENT"));
 const claims={engine_model:"186F"},evidence=await submitSkuEvidence(f.db,{userId:f.admin.userId},{skuId:f.sku.id,type:"FACTORY_SPEC_SHEET",notes:"Synthetic source",claims});
 await reviewSkuEvidence(f.db,{userId:f.admin.userId},{evidenceId:evidence.id,status:"ACCEPTED",reason:"Source checked",claims});
 await reportPhotoAttention(f.db,f.warehouse,f.report("PLATE_ABSENT"));
 expect(await f.db.query.skuFieldProvenance.findFirst({where:(r,{and,eq})=>and(eq(r.skuId,f.sku.id),eq(r.fieldName,"engine_model"))})).toMatchObject({value:"186F",status:"VERIFIED",observationReason:null,observationId:null});
});
it("records Class A absence only on its intake; duplicates attach observations to the original intake",async()=>{
 const f=await fixture(),duplicate=await receiveIntake(f.db,f.warehouse,{...f.scan,idempotencyKey:createUuidV7()});
 const report={...f.report("PLATE_ABSENT"),intakeId:duplicate.body.id};await reportPhotoAttention(f.db,f.warehouse,report);
 expect(await f.db.query.identificationObservations.findFirst({where:eq(identificationObservations.id,report.idempotencyKey)})).toMatchObject({intakeId:f.intake.body.id,skuId:f.sku.id});
 const review=await receiveIntake(f.db,f.warehouse,{...f.scan,idempotencyKey:createUuidV7(),scannedValue:"KH-999999"});
 const counts=()=>Promise.all([skus,skuFieldProvenance].map(table=>f.db.select({count:sql<number>`count(*)::int`}).from(table)));const before=await counts();
 const absent={...f.report("PLATE_ABSENT","IDENTIFICATION"),intakeId:review.body.id};await reportPhotoAttention(f.db,f.warehouse,absent);expect(await counts()).toEqual(before);
 expect(await f.db.query.identificationObservations.findFirst({where:eq(identificationObservations.id,absent.idempotencyKey)})).toMatchObject({skuId:null,intakeId:review.body.id,fieldName:"model_code"});
 await resolveIntakeReview(f.db,f.admin,{idempotencyKey:createUuidV7(),intakeId:review.body.id,resolution:"LINK_EXISTING",skuId:f.sku.id,note:"Administrator resolved the physical unit"});
 expect(await f.db.query.skuFieldProvenance.findFirst({where:(r,{and,eq})=>and(eq(r.skuId,f.sku.id),eq(r.fieldName,"model_code"))})).toMatchObject({status:"NOT_FOUND",observationId:absent.idempotencyKey,observationReason:"PLATE_ABSENT"});
});
it("resolves a requested engine slot by attributed absence without inventing a photo; later remains unfinished",async()=>{
 const f=await fixture(),task=await createScanTask(f.db,f.admin,{idempotencyKey:createUuidV7(),taskType:"PHOTO_REQUEST",title:"Engine plate",assigneeUserId:f.warehouse.userId,targetSkuId:f.sku.id,requestedPhotoSlots:["ENGINE_IDENTIFICATION"],photoRequestNote:"Check for the engine plate"});
 const report={...f.report("LATER"),intakeId:undefined,photoRequestTaskId:task.body.id};
 await reportPhotoAttention(f.db,f.warehouse,report);expect(await f.db.query.scanTasks.findFirst({where:(r,{eq})=>eq(r.id,task.body.id)})).toMatchObject({status:"IN_PROGRESS",completedCount:0});
 const absent={...report,idempotencyKey:createUuidV7(),outcome:"PLATE_ABSENT",reason:"PLATE_ABSENT"};await reportPhotoAttention(f.db,f.warehouse,absent);
 expect(await f.db.query.scanTasks.findFirst({where:(r,{eq})=>eq(r.id,task.body.id)})).toMatchObject({status:"COMPLETED",completedCount:1});
 expect(await f.db.select().from(productImages).where(eq(productImages.photoRequestTaskId,task.body.id))).toEqual([]);
 expect((await f.db.select().from(auditLogs).where(eq(auditLogs.entityId,task.body.id))).some(row=>(row.afterJson?.resolvedObservationIds as string[]|undefined)?.includes(absent.idempotencyKey))).toBe(true);
});
it("accepts an engine plate through the normal private image pipeline and distinguishes it from an absent observation",async()=>{
 const f=await fixture(),directory=await mkdtemp(path.join(tmpdir(),"khidi-h10-plate-"));
 try {
  await reportPhotoAttention(f.db,f.warehouse,f.report("PLATE_ABSENT"));
  const photoId=createUuidV7();
  const result=await receivePhoto(f.db,new FilesystemMediaStorage(directory),f.warehouse,{idempotencyKey:photoId,userId:f.warehouse.userId,deviceId:f.scan.deviceId,capturedAt:new Date().toISOString(),slot:"ENGINE_IDENTIFICATION",intakeId:f.intake.body.id},await fixturePhoto());
  expect(result.body).toMatchObject({id:photoId});
  expect(await f.db.query.productImages.findFirst({where:eq(productImages.id,photoId)})).toMatchObject({slot:"ENGINE_IDENTIFICATION",role:"IDENTITY",usage:"INTERNAL_EVIDENCE"});
  const context=await getPhotoCaptureContext(f.db,f.warehouse,{intakeId:f.intake.body.id});expect(context.acceptedSlots).toContain("ENGINE_IDENTIFICATION");expect(context.resolvedSlots).toEqual([]);
  expect(await f.db.query.intakePhotoStatus.findFirst({where:(r,{eq})=>eq(r.intakeId,f.intake.body.id)})).toMatchObject({status:"PENDING",attentionReason:null});
 }finally{await rm(directory,{recursive:true,force:true});}
});
