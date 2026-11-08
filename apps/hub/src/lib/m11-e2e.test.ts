import { mkdtemp,rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { expect,it } from "vitest";
import { FilesystemMediaStorage } from "../../../../packages/media/src/storage.ts";
import { runM11Scenarios } from "../../../../ops/m11-e2e-scenarios.ts";
it("M11 A–D: observable identity, both stores, declared stock, HTTP sales, signed provenance and cross-entity reports",async()=>{
 const root=await mkdtemp(path.join(tmpdir(),"khidi-m11-e2e-"));
 try{expect(await runM11Scenarios(new FilesystemMediaStorage(root))).toMatchObject({passed:true,scenarios:["A","B","C","D"],inventoryVerified:true});}
 finally{if(path.dirname(path.resolve(root))!==path.resolve(tmpdir())||!path.basename(root).startsWith("khidi-m11-e2e-"))throw new Error("Unsafe cleanup path.");await rm(root,{recursive:true,force:true});}
},120000);
