import { assertTestDatabaseSafety } from "../packages/db/src/test-database-safety.ts";
import { assertEmptySyntheticRestoreSource } from "../packages/db/src/restore-verification.ts";
import { runMigrations,runSeed,getDb,closeAppPool } from "../packages/db/src/index.ts";
import { runProductsSeed } from "../packages/products/src/seed-products.ts";
import { createMediaStorage } from "../packages/media/src/storage-config.ts";
import { deployMediaJobs } from "../packages/media/src/jobs-runtime.ts";
import { generateDailyReports } from "../packages/reports/src/daily.ts";
import { submitSkuEvidence } from "../packages/evidence/src/registry.ts";
import { createUuidV7 } from "../packages/shared/src/uuid.ts";
import { runM11Scenarios } from "./m11-e2e-scenarios.ts";
assertTestDatabaseSafety();
if(process.env.KHIDI_SYNTHETIC_RESTORE_SOURCE!=="1")throw new Error("SAFETY: internal synthetic fixture entry point.");
await assertEmptySyntheticRestoreSource(process.env.DATABASE_MIGRATOR_URL!);
try {
 await runMigrations();await runSeed();await runProductsSeed();await deployMediaJobs();
 const storage=createMediaStorage(),result=await runM11Scenarios(storage),db=getDb();
 const sku=await db.query.skus.findFirst({where:(s,{eq})=>eq(s.id,result.skuId)});
 const intake=await db.query.productIntakes.findFirst({where:(i,{eq})=>eq(i.id,result.intakeId)});
 const pdf=new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n");
 const object=await storage.putPrivate(`evidence/${createUuidV7()}/original.pdf`,pdf,"application/pdf");
 await submitSkuEvidence(db,{userId:intake!.scannedBy},{skuId:sku!.id,type:"FACTORY_SPEC_SHEET",claims:{},notes:"Synthetic private restore attachment, not identity evidence"},{key:object.key,sha256:object.sha256,mimeType:"application/pdf"});
 await generateDailyReports(db,storage);
 console.log(JSON.stringify({syntheticSourceReady:true,scenarios:result.scenarios}));
}finally{await closeAppPool();}
