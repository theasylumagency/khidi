import { randomInt } from "node:crypto";
import { expect, it } from "vitest";
import fc from "fast-check";
import { and, eq, inArray } from "drizzle-orm";
import { allocationBalances, fulfillmentLines, fulfillmentRequests, poolSkuBalances, reservationExpiryJobs, reservationLines, reservations, stockLedger, type DbExecutor } from "@khidi/db";
import { extendReservation, setFulfillmentMode } from "@khidi/reservations";
import { AppError, createUuidV7 } from "@khidi/shared";
import { reservationFixture } from "../../reservations/src/reservation.test-fixture.ts";
import { cancelFulfillment, confirmFulfillmentUnit, confirmOrder, handoverOrder, markLostInStaging, releaseOrder, reserveOrder } from "./index.ts";
import { executeReservationExpiry } from "./jobs.ts";
import { initialWorkflowModel, modelBalances, modelCommand, modelOps, type ModelCommand } from "./workflow-model.test-fixture.ts";

function integer(name:string,fallback:number,min:number,max:number) {const n=process.env[name]===undefined ? fallback : Number(process.env[name]);if(!Number.isInteger(n)||n<min||n>max)throw new Error("Invalid "+name);return n;}
const runs=integer("INVENTORY_PROPERTY_RUNS",25,1,100000),seed=integer("INVENTORY_PROPERTY_SEED",randomInt(-2147483648,2147483647),-2147483648,2147483647);
const command=fc.record({op:fc.constantFrom(...modelOps),slot:fc.integer({min:0,max:1}),malformed:fc.boolean()});
const paths=["handover","cancel","lost","expire","expireBeforeCommit"] as const;
const program=fc.record({simple:fc.boolean(),cod:fc.boolean(),bundle:fc.boolean(),quantity:fc.integer({min:2,max:3}),path:fc.constantFrom(...paths),commands:fc.array(command,{minLength:6,maxLength:14})});

it("extends the independent inventory unit model through complete reservation and fulfillment workflows",async()=>{
  console.info(`[M9 property] runs=${runs} seed=${seed} (INVENTORY_PROPERTY_SEED replays)`);
  const f=await reservationFixture(),bundle=await f.bundle(),staff={type:"USER" as const,userId:f.actor.userId};
  const skuIds=[f.sku.id,bundle.second.sku.id],allocationIds=[f.as[0]!.id,bundle.second.allocation.id],coverage=new Map<string,number>();let completed=0;
  async function balances(tx:DbExecutor) {
    const [p,a,ledger]=await Promise.all([tx.select().from(poolSkuBalances).where(and(eq(poolSkuBalances.poolId,f.pool.id),inArray(poolSkuBalances.skuId,skuIds))),
      tx.select().from(allocationBalances).where(inArray(allocationBalances.allocationId,allocationIds)),tx.select().from(stockLedger).where(inArray(stockLedger.skuId,skuIds))]);
    return {p,a,ledger};
  }
  const examples=paths.flatMap((path)=>[false,true].map((cod)=>[{simple:false,cod,bundle:true,quantity:2,path,commands:[] as ModelCommand[]}]));
  await fc.assert(fc.asyncProperty(program,async(program)=>{
    const rollback=new Error("Rollback generated M9 program");
    try {await f.db.transaction(async(tx)=>{
      await setFulfillmentMode(tx,staff,createUuidV7(),{mode:program.simple ? "SIMPLIFIED_FULFILLMENT" : "CONTROLLED_FULFILLMENT"});
      let model=initialWorkflowModel(program.simple,program.cod,program.bundle,program.quantity),reservationId:string|undefined,requestId:string|undefined,expiryJobId:string|undefined,deadline=Date.now()+1800000;
      const key=createUuidV7(),cartSku=program.bundle ? bundle.sku.id : f.sku.id;
      const confirmation={deliveryMethod:"PICKUP",shipBy:"2030-01-01",prices:[{skuId:cartSku,finalUnitPriceMinor:9000,currency:"GEL"}]};
      let before=await balances(tx),index=0;
      async function run(c:ModelCommand) {
        const next=structuredClone(model),accepted=modelCommand(next,c),label=`${index++}: ${JSON.stringify(c)}`;
        let actual=true;
        try {
          const malformed=c.malformed ? {customer:"Forbidden field"} : {};
          const [line]=requestId && skuIds[c.slot] ? await tx.select().from(fulfillmentLines).where(and(eq(fulfillmentLines.fulfillmentRequestId,requestId),eq(fulfillmentLines.skuId,skuIds[c.slot]!))) : [];
          const unit={fulfillmentRequestId:requestId??createUuidV7(),lineId:line?.id??createUuidV7(),action:c.op==="return" ? "RETURN" : "PICK",
            confirmation:{method:"MANUAL",reason:"Specific unit has an unreadable label"},...malformed};
          switch(c.op) {
            case "reserve": {
              const r=await reserveOrder(tx,f.principal,key,{storefrontOrderRef:"MODEL-1",paymentMethod:program.cod ? "CASH_ON_DELIVERY" : "CARD",items:[{skuId:cartSku,quantity:program.quantity}],
                ...(program.cod ? {confirmation} : {}),...malformed});
              reservationId=r.body.reservationId!;requestId=r.body.fulfillmentRequestId??requestId;
              const [header]=await tx.select().from(reservations).where(eq(reservations.id,reservationId));deadline=header!.expiresAt.getTime();
              [expiryJobId]=(await tx.select().from(reservationExpiryJobs).where(eq(reservationExpiryJobs.reservationId,reservationId))).map((j)=>j.id);break;
            }
            case "extend": {
              const r=await extendReservation(tx,f.principal,createUuidV7(),{reservationId:reservationId??createUuidV7(),expiresAt:new Date(deadline+60000).toISOString(),...malformed});
              actual=r.status<400;if(actual)deadline+=60000;break;
            }
            case "commit": {
              const r=await confirmOrder(tx,f.principal,createUuidV7(),{reservationId:reservationId??createUuidV7(),confirmation,...malformed});
              actual=r.status<400;requestId=r.body.fulfillmentRequestId??requestId;break;
            }
            case "expire": {
              if(!reservationId || c.malformed) {await executeReservationExpiry(tx,createUuidV7());break;}
              if(["RESERVED","COMMITTED"].includes(model.state)) {
                const expiresAt=new Date(Date.now()-1000);deadline=expiresAt.getTime();
                await tx.update(reservations).set({expiresAt}).where(eq(reservations.id,reservationId));
                expiryJobId=createUuidV7();await tx.insert(reservationExpiryJobs).values({id:expiryJobId,reservationId,expiresAt});
              }
              await executeReservationExpiry(tx,expiryJobId!);break;
            }
            case "pick": case "return": await confirmFulfillmentUnit(tx,staff,createUuidV7(),unit);break;
            case "handover": await handoverOrder(tx,staff,createUuidV7(),{fulfillmentRequestId:requestId??createUuidV7(),...malformed});break;
            case "cancel": await cancelFulfillment(tx,staff,createUuidV7(),{fulfillmentRequestId:requestId??createUuidV7(),reason:"Model cancellation",...malformed});break;
            case "release": await releaseOrder(tx,f.principal,createUuidV7(),{reservationId:reservationId??createUuidV7(),reason:"Model release",...malformed});break;
            case "lost": await markLostInStaging(tx,staff,createUuidV7(),{fulfillmentRequestId:requestId??createUuidV7(),lineId:line?.id??createUuidV7(),reason:"Specific staged unit missing",...malformed});break;
          }
        } catch(error) {
          if(!(error instanceof AppError) || !["NOT_FOUND","PRECONDITION_FAILED","VALIDATION_ERROR","IDEMPOTENCY_CONFLICT"].includes(error.code))throw error;
          actual=false;
        }
        expect(actual,label).toBe(accepted);
        const after=await balances(tx);if(!accepted)expect(after,label+" changed stock on rejection").toEqual(before);
        model=next;
        for(let slot=0;slot<2;slot++) {
          const expected=modelBalances(model,slot);
          expect(after.p.find((p)=>p.skuId===skuIds[slot]),label).toMatchObject({shelf:expected.shelf,staging:expected.staging,allocatedTotal:expected.allocatedTotal});
          expect(after.a.find((a)=>a.allocationId===allocationIds[slot]),label).toMatchObject({allocated:expected.allocated,reserved:expected.reserved,committed:expected.committed,availableToSell:expected.availableToSell});
        }
        if(reservationId) {
          expect((await tx.select().from(reservations).where(eq(reservations.id,reservationId)))[0]!.status,label).toBe(model.state);
          const requests=await tx.select().from(fulfillmentRequests).where(eq(fulfillmentRequests.reservationId,reservationId));
          expect(requests,label).toHaveLength(model.request==="NONE" ? 0 : 1);
          if(requests[0]) {
            expect(requests[0],label).toMatchObject({status:model.request,requiresReturnToShelf:model.returnPending});
            const physical=await tx.select().from(fulfillmentLines).where(eq(fulfillmentLines.fulfillmentRequestId,requests[0].id));
            for(let slot=0;slot<2;slot++) if(model.counts[slot]) expect(physical.find((l)=>l.skuId===skuIds[slot]),label).toMatchObject({quantity:model.counts[slot],pickedQuantity:model.picked[slot],returnedQuantity:model.returned[slot],lostQuantity:model.lost[slot],handedOverQuantity:model.handed[slot]});
          }
          const snapshots=await tx.select().from(reservationLines).where(eq(reservationLines.reservationId,reservationId));
          for(let slot=0;slot<2;slot++)if(model.counts[slot])expect(snapshots.find((l)=>l.skuId===skuIds[slot]),label).toMatchObject({quantity:model.counts[slot],releasedQuantity:model.released[slot]});
        }
        const outcome=c.op+":"+(accepted ? "accepted" : "rejected");coverage.set(outcome,(coverage.get(outcome)??0)+1);before=after;
      }
      const c=(op:ModelCommand["op"],slot=0,malformed=false)=>({op,slot,malformed});
      await run(c("pick"));await run(c("reserve"));await run(c("extend"));
      if(program.path==="expireBeforeCommit")await run(c("expire"));
      if(!program.cod)await run(c("commit"));
      await run(c("pick"));
      if(program.path==="handover") {
        for(let slot=0;slot<2;slot++)for(let i=(slot===0?1:0);i<model.counts[slot]!;i++)await run(c("pick",slot));
        await run(c("handover"));
      } else {
        if(program.path==="lost") {await run(c("pick"));await run(c("lost"));}
        else if(program.path==="expire")await run(c("expire"));
        else await run(c("cancel"));
        for(let slot=0;slot<2;slot++)for(let i=0;i<model.counts[slot]!;i++)await run(c("return",slot));
        await run(c("release"));
      }
      for(const command of program.commands)await run(command);
      throw rollback;
    });}catch(error){if(error!==rollback)throw error;}
    if(++completed%25===0)console.info(`[M9 property] completed=${completed}/${runs} seed=${seed}`);
  }),{numRuns:runs,seed,examples,verbose:true});
  for(const op of modelOps)expect(coverage.get(op+":accepted"),op+" accepted coverage").toBeGreaterThan(0);
  expect(coverage.get("pick:rejected")).toBeGreaterThan(0);
  console.info(`[M9 property] passed runs=${runs} seed=${seed} coverage=${JSON.stringify(Object.fromEntries(coverage))}`);
},Math.max(120000,runs*5000));
