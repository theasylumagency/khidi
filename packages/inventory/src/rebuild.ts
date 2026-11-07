import { eq, sql } from "drizzle-orm";
import { allocationBalances, allocations, poolSkuBalances, stockLedger, type DbExecutor } from "@khidi/db";

export interface RebuiltPool { poolId: string; skuId: string; shelf: number; staging: number; allocatedTotal: number; unallocated: number }
export interface RebuiltAllocation { allocationId: string; allocated: number; reserved: number; committed: number; availableToSell: number }
export interface RebuiltBalances { pools: RebuiltPool[]; allocations: RebuiltAllocation[] }
export interface BalanceDifference { kind: "pool" | "allocation"; key: string; field: string; expected: number | null; actual: number | null }

/** A reconstruction only: never updates or repairs stored data. One statement reads one snapshot. */
export async function rebuildBalancesFromLedger(db: DbExecutor, skuId?: string): Promise<RebuiltBalances> {
  const groups = await db.select({ poolId:stockLedger.poolId, skuId:stockLedger.skuId, allocationId:stockLedger.allocationId,
    shelf:sql<number>`sum(${stockLedger.shelfDelta})::double precision`, staging:sql<number>`sum(${stockLedger.stagingDelta})::double precision`,
    allocatedTotal:sql<number>`sum(${stockLedger.allocTotalDelta})::double precision`, allocated:sql<number>`sum(${stockLedger.allocatedDelta})::double precision`,
    reserved:sql<number>`sum(${stockLedger.reservedDelta})::double precision`, committed:sql<number>`sum(${stockLedger.committedDelta})::double precision`
  }).from(stockLedger).where(skuId ? eq(stockLedger.skuId,skuId) : undefined).groupBy(stockLedger.poolId,stockLedger.skuId,stockLedger.allocationId);
  const pools=new Map<string,RebuiltPool>(), ab=new Map<string,RebuiltAllocation>();
  for(const g of groups) {
    const key=g.poolId+":"+g.skuId, p=pools.get(key)??{poolId:g.poolId,skuId:g.skuId,shelf:0,staging:0,allocatedTotal:0,unallocated:0};
    p.shelf+=g.shelf;p.staging+=g.staging;p.allocatedTotal+=g.allocatedTotal;p.unallocated=p.shelf+p.staging-p.allocatedTotal;pools.set(key,p);
    if(g.allocationId) ab.set(g.allocationId,{allocationId:g.allocationId,allocated:g.allocated,reserved:g.reserved,committed:g.committed,availableToSell:g.allocated-g.reserved-g.committed});
  }
  return {pools:[...pools.values()].sort((a,b)=>(a.poolId+a.skuId).localeCompare(b.poolId+b.skuId)),allocations:[...ab.values()].sort((a,b)=>a.allocationId.localeCompare(b.allocationId))};
}

/** Repeatable-read prevents live writes from appearing as false drift between queries. */
export async function verifyInventoryBalances(db: DbExecutor, skuId?: string) {
  return db.transaction(async(tx)=>{
    const rebuilt=await rebuildBalancesFromLedger(tx,skuId);
    const actualPools=await tx.select().from(poolSkuBalances).where(skuId ? eq(poolSkuBalances.skuId,skuId):undefined);
    const actualAllocations=await tx.select({balance:allocationBalances}).from(allocationBalances).innerJoin(allocations,eq(allocations.id,allocationBalances.allocationId))
      .where(skuId ? eq(allocations.skuId,skuId):undefined);
    const differences:BalanceDifference[]=[];
    function compare<T extends object>(kind:"pool"|"allocation",expected:T[],actual:T[],key:(row:T)=>string,fields:(keyof T)[]) {
      const eMap=new Map(expected.map((row)=>[key(row),row])),aMap=new Map(actual.map((row)=>[key(row),row]));
      for(const k of [...new Set([...eMap.keys(),...aMap.keys()])].sort()) {
        const e=eMap.get(k),a=aMap.get(k);
        for(const field of fields) {
          // Zero initialization rows with no ledger history are valid. Missing rows for ledger history are not.
          const wanted=e ? Number(e[field]):0,stored=a ? Number(a[field]):null;
          if(stored!==wanted) differences.push({kind,key:k,field:String(field),expected:wanted,actual:stored});
        }
      }
    }
    compare<RebuiltPool>("pool",rebuilt.pools,actualPools,(p)=>p.poolId+":"+p.skuId,["shelf","staging","allocatedTotal","unallocated"]);
    compare<RebuiltAllocation>("allocation",rebuilt.allocations,actualAllocations.map((a)=>a.balance),(a)=>a.allocationId,["allocated","reserved","committed","availableToSell"]);
    return {ok:differences.length===0,differences,poolCount:actualPools.length,allocationCount:actualAllocations.length};
  },{isolationLevel:"repeatable read",accessMode:"read only"});
}
