import { expect, it } from "vitest";
import fc from "fast-check";
import { eq } from "drizzle-orm";
import { allocationBalances, poolSkuBalances, stockLedger } from "@khidi/db";
import { inventoryFixture } from "./test-fixture.ts";
import type { StockMovement } from "./types.ts";

it("random valid sequences preserve all C2 invariants and ledger reconstruction",async()=>{
  await fc.assert(fc.asyncProperty(fc.array(fc.record({action:fc.integer({min:0,max:11}),quantity:fc.integer({min:1,max:5})}),{minLength:10,maxLength:28}),async(operations)=>{
    const f=await inventoryFixture();
    const pending:StockMovement[]=[];
    let shelf=100,staging=0,allocated=60,reserved=0,committed=0;
    for(const op of operations) {
      const n=op.quantity,free=allocated-reserved-committed,unallocated=shelf+staging-allocated;
      let m:StockMovement|undefined;
      switch(op.action) {
        case 0: m={...f.base,type:"STOCK_IN",quantity:n};shelf+=n;break;
        case 1: if(n<=unallocated){m={...f.base,type:"STOCK_OUT",quantity:n,reason:"Return"};shelf-=n;} break;
        case 2: if(n<=unallocated){m={...f.line,type:"ALLOCATE",quantity:n};allocated+=n;} break;
        case 3: if(n<=free){m={...f.line,type:"DEALLOCATE",quantity:n};allocated-=n;} break;
        case 4: if(n<=free){m={...f.line,type:"RESERVE",quantity:n,paymentMethod:"CARD"};reserved+=n;} break;
        case 5: if(n<=reserved){m={...f.line,type:"COMMIT",quantity:n};reserved-=n;committed+=n;} break;
        case 6: if(n<=reserved){m={...f.line,type:"RESERVATION_RELEASE",quantity:n};reserved-=n;} break;
        case 7: if(n<=committed-staging){m={...f.line,type:"COMMIT_RELEASE",quantity:n};committed-=n;} break;
        case 8: if(n<=committed-staging && n<=shelf){m={...f.line,type:"PICK_TO_STAGING",quantity:n};shelf-=n;staging+=n;} break;
        case 9: if(n<=staging){m={...f.line,type:"RETURN_TO_SHELF",quantity:n,scanConfirmed:true};shelf+=n;staging-=n;} break;
        case 10: if(n<=staging){m={...f.line,type:"HANDOVER_OUT",quantity:n};staging-=n;allocated-=n;committed-=n;} break;
        case 11: if(n<=unallocated){m={...f.base,type:"WRITE_OFF",quantity:n,reason:"Damage"};shelf-=n;} break;
      }
      if(m) pending.push(m);
    }
    // Split at arbitrary workflow boundaries while still testing intermediate DB constraints.
    for(let i=0;i<pending.length;i+=4) await f.apply(pending.slice(i,i+4));
    const [p]=(await f.db.select().from(poolSkuBalances).where(eq(poolSkuBalances.poolId,f.base.poolId)));
    const balances=await f.db.select().from(allocationBalances).where(eq(allocationBalances.allocationId,f.line.allocationId));
    const a=balances[0]!;
    expect(p).toMatchObject({shelf,staging,allocatedTotal:allocated,unallocated:shelf+staging-allocated});
    expect(a).toMatchObject({allocated,reserved,committed,availableToSell:allocated-reserved-committed});
    expect(shelf).toBeGreaterThanOrEqual(0); expect(staging).toBeGreaterThanOrEqual(0);
    expect(allocated).toBeLessThanOrEqual(shelf+staging); expect(staging).toBeLessThanOrEqual(allocated);
    expect(reserved).toBeGreaterThanOrEqual(0);expect(committed).toBeGreaterThanOrEqual(0);expect(a.availableToSell).toBeGreaterThanOrEqual(0);
    const ledger=await f.db.select().from(stockLedger).where(eq(stockLedger.skuId,f.sku.id));
    const sum=ledger.reduce((v,r)=>v.map((n,i)=>n+[r.shelfDelta,r.stagingDelta,r.allocTotalDelta,r.allocatedDelta,r.reservedDelta,r.committedDelta][i]!),[0,0,0,0,0,0]);
    expect(sum).toEqual([shelf,staging,allocated,allocated,reserved,committed]);
  }),{numRuns:16,seed:82173});
},30000);
