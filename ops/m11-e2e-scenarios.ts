import assert from "node:assert/strict";
import { createServer,type Server } from "node:http";
import { once } from "node:events";
import { getDb,categories } from "../packages/db/src/index.ts";
import { assertTestDatabaseSafety } from "../packages/db/src/test-database-safety.ts";
import { createUuidV7 } from "../packages/shared/src/uuid.ts";
import { withDomainTransaction } from "../packages/domain/src/index.ts";
import { serviceAdminFixture } from "../packages/auth/src/storefront-service.test-fixture.ts";
import { manageStorefrontServiceKey } from "../packages/auth/src/storefront-service.ts";
import { createLegalEntity,createStorefront,setEntityRelationship } from "../packages/entities/src/index.ts";
import { receiveIntake } from "../packages/scanning/src/index.ts";
import { classifySkuProductType,submitSkuEvidence,reviewSkuEvidence } from "../packages/evidence/src/registry.ts";
import { upsertProductType,upsertAccountingMapping,transitionSkuLifecycle,transitionSkuToReady,setStorefrontListing,saveCanonicalVersion,approveCanonicalVersion } from "../packages/products/src/index.ts";
import { receivePhoto } from "../packages/media/src/upload.ts";
import { fixturePhoto } from "../packages/media/src/test-fixtures.ts";
import { processImage } from "../packages/media/src/processing.ts";
import { manageImage } from "../packages/media/src/management.ts";
import { synchronizePublicMedia } from "../packages/media/src/public-media.ts";
import { type MediaStorage } from "../packages/media/src/storage.ts";
import { createStockPool,configureAvailabilityPool,applyAdvancedStockOperation } from "../packages/inventory/src/advanced.ts";
import { setOnlineAvailability } from "../packages/inventory/src/availability.ts";
import { setAllocationMinimum,requestReplenishment } from "../packages/inventory/src/replenishment.ts";
import { verifyInventoryBalances } from "../packages/inventory/src/rebuild.ts";
import { setPrice } from "../packages/pricing/src/index.ts";
import { getStorefrontProductProjection } from "../packages/publishing/src/index.ts";
import { configureStorefrontWebhook,dispatchStorefrontWebhooks } from "../packages/publishing/src/webhooks.ts";
import { getFulfillmentMode,setFulfillmentMode } from "../packages/reservations/src/mode.ts";
import { executeReservationExpiry } from "../packages/fulfillment/src/jobs.ts";
import { consumeNotifications } from "../packages/notifications/src/index.ts";
import { movementReport } from "../packages/reports/src/index.ts";
import { GET,POST } from "../apps/hub/src/app/api/v1/storefront/[store]/[...resource]/route.ts";
import { TestStorefrontClient,exerciseStorefrontFlow,verifyWebhookSignature } from "./storefront-test-client.ts";

const today=()=>new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Tbilisi",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
export async function runM11Scenarios(storage:MediaStorage) {
 assertTestDatabaseSafety();
 for(const name of ["DATABASE_URL","DATABASE_MIGRATOR_URL"] as const)assert(["localhost","127.0.0.1","[::1]"].includes(new URL(process.env[name]!).hostname),"SAFETY: E2E requires loopback test databases.");
 const db=getDb(),admin=await serviceAdminFixture(db),actor={userId:admin.userId},staff={type:"USER" as const,userId:admin.userId},originalMode=await getFulfillmentMode(db,staff);
 const suffix=createUuidV7().replaceAll("-","").slice(-20),servers:Server[]=[];
 const host=process.env.KHIDI_API_HOST??"api.localhost:3100";
 async function listen(server:Server){servers.push(server);server.listen(0,"127.0.0.1");await once(server,"listening");return "http://127.0.0.1:"+(server.address() as import("node:net").AddressInfo).port;}
 try {
  await setFulfillmentMode(db,staff,createUuidV7(),{mode:"SIMPLIFIED_FULFILLMENT"});
  const entities=await Promise.all([0,1].map(i=>createLegalEntity(db,actor,{key:`H11_${i}_${suffix.toUpperCase()}`,legalName:`Synthetic pilot entity ${i}`,taxId:`H11${i}${suffix}`,pricesIncludeVat:true})));
  const stores=await Promise.all(entities.map((entity,i)=>createStorefront(db,actor,{key:`h11-${i}-${suffix}`,name:"Synthetic pilot store",domain:`h11-${i}-${suffix}.example.test`,sellerEntityId:entity.id,mediaBaseUrl:"https://media.example.test",reservationPolicy:{CARD:i?1:1800,BANK_INSTALLMENT:259200,PAY_ON_PICKUP:259200,CASH_ON_DELIVERY:259200}})));
  const pools=await Promise.all(entities.map(entity=>createStockPool(db,actor,{ownerEntityId:entity.id,name:"Synthetic pilot pool"})));
  await setEntityRelationship(db,actor,{fromEntityId:entities[0]!.id,toEntityId:entities[1]!.id,mode:"CONSIGNMENT"});
  for(const store of stores)await configureAvailabilityPool(db,actor,{storefrontId:store.id,poolId:pools[0]!.id});
  const category=await withDomainTransaction(db,actor,async ctx=>{const [row]=await ctx.tx.insert(categories).values({id:createUuidV7(),key:"H11_"+suffix,nameKa:"ინვენტარი",nameEn:"Pilot tools"}).returning();await ctx.recordAudit({action:"SYNTHETIC_E2E_CATEGORY_CREATED",entityType:"category",entityId:row!.id});return row!;});
  const type=await upsertProductType(db,actor,{key:"H11_"+suffix.toUpperCase(),defaultCategoryId:category.id,nameKa:"ინვენტარი",nameEn:"Pilot tool",distinguishingAttributes:["wheel_type"],
   attributeSchemaJson:[{key:"wheel_type",labelKa:"ბორბლები",labelEn:"Wheels",dataType:"enum",enumValues:["RUBBER","IRON"],tier:"REQUIRED_IDENTITY",filterCandidate:true,observable:true}],photoInstructionsJson:[]});
  const intake=await receiveIntake(db,admin,{idempotencyKey:createUuidV7(),userId:admin.userId,deviceId:createUuidV7(),scannedAt:new Date().toISOString(),sourceMode:"QUICK_SCAN",isNoBarcode:true});
  assert.equal(intake.body.resultState,"NEW_DRAFT");const skuId=intake.body.matchedSkuId!;
  await classifySkuProductType(db,actor,skuId,type.id,"Synthetic observable product without supplier documents");
  const imageIds:string[]=[];
  for(const [i,slot] of (["MAIN","SECONDARY"] as const).entries()) {
   const photo=await receivePhoto(db,storage,admin,{idempotencyKey:createUuidV7(),userId:admin.userId,deviceId:createUuidV7(),capturedAt:new Date().toISOString(),slot,skuId,intakeId:intake.body.id,intakeIdempotencyKey:null,photoRequestTaskId:null},await fixturePhoto(1920,1280,i));
   const imageId=String(photo.body.id);imageIds.push(imageId);await withDomainTransaction(db,actor,ctx=>processImage(ctx,storage,imageId,1));
   await manageImage(db,admin,{idempotencyKey:createUuidV7(),imageId,action:"UPDATE",role:i?"GALLERY":"MAIN",usage:"PUBLIC"});
   await manageImage(db,admin,{idempotencyKey:createUuidV7(),imageId,action:"VERIFY"});
  }
  const inspection=await submitSkuEvidence(db,actor,{skuId,type:"ADMIN_PHYSICAL_INSPECTION",claims:{wheel_type:"RUBBER"},notes:"Observable rubber wheels; no supplier documents available"});
  await reviewSkuEvidence(db,actor,{evidenceId:inspection.id,status:"ACCEPTED",claims:inspection.claims,reason:"Observed against reference photographs"});
  for(const entity of entities)await upsertAccountingMapping(db,actor,{skuId,legalEntityId:entity.id,accountingItemId:"snapshot-"+entity.id,accountingName:"Original pilot accounting"});
  for(const state of ["IDENTIFIED","CONTENT_GENERATING","CONTENT_REVIEW"] as const)await transitionSkuLifecycle(db,actor,skuId,state);
  const content=await saveCanonicalVersion(db,actor,{skuId,locale:"ka"});await approveCanonicalVersion(db,actor,{skuId,versionId:content.version.id});
  await transitionSkuToReady(db,actor,skuId,{humanConfirmedMediumConfidence:true,allowHouseSlugSuffix:true});
  const sku=await db.query.skus.findFirst({where:(s,{eq})=>eq(s.id,skuId)});assert.equal(sku!.identityKind,"HOUSE_DEFINED");assert.equal(sku!.identityConfidence,"MEDIUM");
  for(const store of stores){await setStorefrontListing(db,actor,{skuId,storefrontId:store.id,enabled:true,reason:"Synthetic pilot listing"});await setPrice(db,actor,{skuId,storefrontId:store.id,basePriceMinor:10000});}
  await synchronizePublicMedia(db,storage,skuId);
  const declare=(i:number,target:number,replenishmentRequestId?:string)=>setOnlineAvailability(db,actor,{skuId,storefrontId:stores[i]!.id,target,idempotencyKey:createUuidV7(),...(replenishmentRequestId?{replenishmentRequestId}:{})});
  const own=await declare(0,60),foreign=await declare(1,12);
  for(const store of stores)assert.equal((await getStorefrontProductProjection(db,{skuId,storefrontId:store.id,locale:"ka"}))?.sellable,true);
  // B: a low-stock event and explicit declaration close the replenishment request, only on its allocation.
  await setAllocationMinimum(db,actor,{allocationId:foreign.body.allocationId,minimum:5});await declare(1,2);
  const low=await db.query.outboxEvents.findFirst({where:(e,{and,eq})=>and(eq(e.aggregateId,foreign.body.allocationId),eq(e.eventType,"STOCK_LOW"))});assert(low);await consumeNotifications(db,low.id);
  assert(await db.query.notifications.findFirst({where:(n,{eq})=>eq(n.eventId,low.id)}));
  const replenishment=await requestReplenishment(db,actor,{allocationId:foreign.body.allocationId,quantity:10});await declare(1,12,replenishment.id);
  assert.equal((await db.query.replenishmentRequests.findFirst({where:(r,{eq})=>eq(r.id,replenishment.id)}))!.status,"FULFILLED");
  assert.equal((await db.query.allocationBalances.findFirst({where:(b,{eq})=>eq(b.allocationId,own.body.allocationId)}))!.availableToSell,60);
  const base=await listen(createServer(async(req,res)=>{
   try {const chunks:Buffer[]=[];let length=0;for await(const chunk of req){length+=chunk.length;if(length>65536){res.writeHead(413);res.end();return;}chunks.push(Buffer.from(chunk));}
    const headers=new Headers();for(const [name,value]of Object.entries(req.headers))if(value)headers.set(name,Array.isArray(value)?value.join(","):value);
    const request=new Request("http://"+req.headers.host+req.url,{method:req.method,headers,...(req.method==="POST"?{body:Buffer.concat(chunks)}:{})});
    const parts=new URL(request.url).pathname.split("/").slice(4),params={params:Promise.resolve({store:parts[0]!,resource:parts.slice(1)})};
    const response=await(req.method==="POST"?POST:GET)(request,params);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());
   }catch{res.writeHead(500);res.end("{}");}
  }));
  const clients:TestStorefrontClient[]=[];
  for(const store of stores){const key=await manageStorefrontServiceKey(db,admin,createUuidV7(),{action:"ISSUE",storefrontId:store.id,name:"Synthetic pilot HTTP client"});clients.push(new TestStorefrontClient(base,host,store.key,key.body.rawApiKey!));}
  // C: genuine HTTP handler, test storefront client, signed receiver and one immutable final event.
  const events:Record<string,any>[]=[];let secret="";
  const receiver=await listen(createServer(async(req,res)=>{let text="";for await(const chunk of req){text+=chunk;if(text.length>65536){res.writeHead(413);res.end();return;}}const valid=verifyWebhookSignature(secret,String(req.headers["x-khidi-timestamp"]),text,String(req.headers["x-khidi-signature"]));if(valid)events.push(JSON.parse(text));res.writeHead(valid?204:401);res.end();}));
  secret=(await configureStorefrontWebhook(db,admin,createUuidV7(),{storefrontId:stores[0]!.id,url:receiver+"/events"})).body.secret!;
  const sale=await exerciseStorefrontFlow(clients[0]!,skuId);
  const finalEvents=await db.query.outboxEvents.findMany({where:(e,{and,eq})=>and(eq(e.aggregateId,sale.fulfillmentRequestId),eq(e.eventType,"FULFILLMENT_STATUS_CHANGED"))});
  for(const event of finalEvents){const delivery=await db.query.outboxDeliveries.findFirst({where:(d,{and,eq})=>and(eq(d.outboxEventId,event.id),eq(d.consumer,"storefront:"+stores[0]!.id))});if(delivery)await dispatchStorefrontWebhooks(db,{onlyDeliveryId:delivery.id});}
  assert(events.some(e=>e.data.status==="HANDED_OVER"&&e.data.confirmation==="AUTO_ASSUMED"));
  const confirmation={deliveryMethod:"PICKUP",shipBy:"2030-01-01",prices:[{skuId,finalUnitPriceMinor:12000,currency:"GEL"}]};
  const orderRef="H11-"+suffix;
  for(const [i,paymentMethod]of (["PAY_ON_PICKUP","CASH_ON_DELIVERY"] as const).entries()) {
   const response=await clients[i]!.call("reservations",{storefrontOrderRef:orderRef+"-"+i,paymentMethod,items:[{skuId,quantity:1}],confirmation},createUuidV7());assert.equal(response.status,201);assert.equal(response.body.status,"HANDED_OVER");assert.equal(response.body.confirmation,"AUTO_ASSUMED");
  }
  // Exactly one winner for the final unit. Its real one-second database deadline releases it.
  await declare(1,1);const race=await Promise.all([0,1].map(i=>clients[1]!.call("reservations",{storefrontOrderRef:orderRef+"-race-"+i,paymentMethod:"CARD",items:[{skuId,quantity:1}]},createUuidV7())));
  assert.equal(race.filter(r=>r.status===201).length,1);assert.equal(race.filter(r=>r.status===409).length,1);
  const winner=race.find(r=>r.status===201)!,expiry=await db.query.reservationExpiryJobs.findFirst({where:(j,{eq})=>eq(j.reservationId,winner.body.reservationId)});assert(expiry);
  await new Promise(resolve=>setTimeout(resolve,Math.max(0,expiry.expiresAt.getTime()-Date.now())+50));assert.equal((await executeReservationExpiry(db,expiry.id)).status,"PROCESSED");
  assert.equal((await clients[1]!.call("stock/"+skuId)).body.availableToSell,1);
  // D: seller and owner frozen snapshots survive current mapping/price changes.
  for(const entity of entities)await upsertAccountingMapping(db,actor,{skuId,legalEntityId:entity.id,accountingItemId:"changed-"+entity.id,accountingName:"Changed pilot accounting",replaceExistingForEntity:true});
  await setPrice(db,actor,{skuId,storefrontId:stores[1]!.id,basePriceMinor:99000},{confirmLargeChanges:true,reason:"Synthetic snapshot verification"});
  const range=(entityId:string)=>({entityId,from:today(),to:today()});
  const ownerReport=await movementReport(db,admin.userId,range(entities[0]!.id)),sellerReport=await movementReport(db,admin.userId,range(entities[1]!.id));
  for(const rows of [ownerReport.owner,sellerReport.seller])assert(rows.some(r=>r.orderRef===orderRef+"-1"&&r.accountingName==="Original pilot accounting"&&r.totalMinor==="12000"&&r.provenance==="AUTO_ASSUMED"));
  assert(ownerReport.seller.some(r=>r.provenance==="AUTO_ASSUMED"&&r.totalMinor==="10000"));
  await assert.rejects(setEntityRelationship(db,actor,{fromEntityId:entities[0]!.id,toEntityId:entities[1]!.id,mode:"PURCHASE"}));
  await declare(1,0);await configureAvailabilityPool(db,actor,{storefrontId:stores[1]!.id,poolId:pools[1]!.id});
  await setEntityRelationship(db,actor,{fromEntityId:entities[0]!.id,toEntityId:entities[1]!.id,mode:"PURCHASE"});
  const documentRef="H11-transfer-"+suffix;
  await applyAdvancedStockOperation(db,actor,{operation:"STOCK_IN",poolId:pools[0]!.id,skuId,quantity:2,reason:"Synthetic purchase source"});
  await applyAdvancedStockOperation(db,actor,{operation:"TRANSFER_PURCHASE",poolId:pools[0]!.id,targetPoolId:pools[1]!.id,skuId,quantity:2,documentRef,reason:"Synthetic purchase document"});
  for(const entity of entities)assert((await movementReport(db,admin.userId,range(entity.id))).transfers.some(r=>r.document===documentRef&&r.quantity===2));
  assert.equal((await verifyInventoryBalances(db,skuId)).ok,true);
  return {passed:true,scenarios:["A","B","C","D"],skuId,imageIds,intakeId:intake.body.id,webhooks:events.length,inventoryVerified:true};
 } finally {
  await Promise.all(servers.map(server=>new Promise<void>(resolve=>{server.closeAllConnections();server.close(()=>resolve());})));
  await setFulfillmentMode(db,staff,createUuidV7(),{mode:originalMode});
 }
}
