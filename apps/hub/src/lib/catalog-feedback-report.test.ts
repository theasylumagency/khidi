import { expect,it } from "vitest";
import type { PilotRow } from "@khidi/catalog-review";
import { fieldKeys,originals,startReview } from "@khidi/catalog-review/fields";
import { exportWorkbook } from "@khidi/reports";
import { pilotReport } from "./catalog-feedback-report.ts";

it("exports exactly six records per completed card and three ordered survey answers",async()=>{
  const card={wp:1,type:"type",name:"ერთი ორი",description:"description",facts:["A","B","C"],kit:[],links:[],questions:[]};
  const original=originals(card,[]), fields=startReview(original);
  for(const k of fieldKeys) fields[k].verdict="OK";
  fields.facts={value:["C","A","B"],verdict:"EDIT",reason:"first",unknown:false};
  const row:PilotRow={card,original,response:{fields,answers:[],layout:{order:["facts","description","kit","links"],missing:"price"},activeSeconds:150},
    id:"id",batch:"batch",position:1,round:1,cardRevision:2,photoKinds:{},photoIds:[],revision:1,submitted:true,canWrite:false,actor:"reviewer",at:new Date(),legacy:null};
  const rows=Array.from({length:20},(_,i)=>({...row,position:i+1,card:{...card,wp:i+1}}));
  const [details,survey]=pilotReport([...rows,{...row,submitted:false}],["one","two","=safe"]);
  expect(details!.rows).toHaveLength(120);
  expect(details!.rows[2]!.slice(4,13)).toEqual(["facts",expect.any(String),"A\nB\nC","C\nA\nB",expect.any(String),"first","","","C (3 → 1)"]);
  expect(details!.rows[0]!.slice(-5)).toEqual(["2",expect.stringContaining(" → "),"price","3",""]);
  expect(survey!.rows.map(r=>r[1])).toEqual(["one","two","=safe"]);
  expect((await exportWorkbook([details!,survey!])).subarray(0,4)).toEqual(Buffer.from([80,75,3,4]));
});
