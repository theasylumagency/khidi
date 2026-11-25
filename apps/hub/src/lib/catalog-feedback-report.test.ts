import { expect,it } from "vitest";
import type { PilotRow } from "@khidi/catalog-review";
import { fieldKeys,originals,startReview } from "@khidi/catalog-review/fields";
import { exportWorkbook } from "@khidi/reports";
import { t } from "@khidi/i18n";
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

it("reports saved drafts on their own sheet without counting them as completed",()=>{
  const card={wp:9,type:"type",name:"მონახაზი",description:"d",facts:[],kit:[],links:[],questions:[]};
  const original=originals(card,[]), fields=startReview(original);
  const base:PilotRow={card,original,response:{fields,answers:[],activeSeconds:0},id:"id",batch:"batch",position:1,round:1,cardRevision:1,
    photoKinds:{},photoIds:[],revision:2,submitted:false,canWrite:true,actor:"reviewer",at:new Date(),legacy:null};
  const untouched={...base,id:"new",revision:0,response:null};
  const [details,survey,drafts]=pilotReport([base,untouched]);
  expect(details!.rows).toHaveLength(0);
  expect(survey!.rows).toHaveLength(3);
  expect(drafts!.name).toBe(t("fields.draftsSheet"));
  expect(drafts!.headers).toEqual(details!.headers);
  expect(drafts!.rows).toHaveLength(6);
  expect(drafts!.rows.every(r=>r[1]==="9")).toBe(true);
});
