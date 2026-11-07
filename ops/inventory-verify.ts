import { closeAppPool, getDb } from "../packages/db/src/index.ts";
import { verifyInventoryBalances } from "../packages/inventory/src/rebuild.ts";

// Explicit target only. Verification must never silently select the development fallback.
if (!process.env.DATABASE_URL?.trim()) throw new Error("DATABASE_URL is required for inventory verification.");
try {
  const result=await verifyInventoryBalances(getDb());
  console.log(JSON.stringify(result,null,2));
  if(!result.ok) process.exitCode=1;
} catch(error) {
  console.error(error instanceof Error ? error.message : "Inventory verification failed.");
  process.exitCode=2;
} finally {await closeAppPool();}
