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
    id:"id",batch:"batch",position:1,round:1,cardRevision:2,photoKinds:{},photoIds:[],revision:1,submitted:true,canWrite:false,locked:false,actor:"reviewer",at:new Date(),legacy:null};
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
    photoKinds:{},photoIds:[],revision:2,submitted:false,canWrite:true,locked:false,actor:"reviewer",at:new Date(),legacy:null};
  const untouched={...base,id:"new",revision:0,response:null};
  const [details,survey,drafts]=pilotReport([base,untouched]);
  expect(details!.rows).toHaveLength(0);
  expect(survey!.rows).toHaveLength(3);
  expect(drafts!.name).toBe(t("fields.draftsSheet"));
  expect(drafts!.headers).toEqual(details!.headers);
  expect(drafts!.rows).toHaveLength(6);
  expect(drafts!.rows.every(r=>r[1]==="9")).toBe(true);
  const closed=pilotReport([base,untouched],[],{note:"enough learned",submitted:0,drafts:1,untouched:1,createdAt:new Date("2026-11-26T08:00:00Z")});
  expect(closed[1]!.rows.slice(3)).toEqual([[t("fields.closed"),"2026-11-26T08:00:00.000Z · enough learned"],[t("fields.closedCounts"),"0 / 1 / 1"]]);
  expect(closed[0]!.rows).toHaveLength(0);
});

it("keeps unanswered questions distinct from explicit uncertainty in exported draft evidence",()=>{
  const card={wp:9,type:"type",name:"მონახაზი",description:"d",facts:[],kit:[],links:[],questions:[
    {field:"facts",prompt:"ცნობილი კითხვა"},{field:"facts",prompt:"დასაზუსტებელი კითხვა"},{field:"facts",prompt:"უპასუხო კითხვა"}
  ]};
  const original=originals(card,[]);
  const row:PilotRow={card,original,response:{fields:startReview(original),answers:[
    {state:"KNOWN",text:"100 ლ",source:"ინსტრუქცია"},
    {state:"UNKNOWN",text:"ფირფიტის ფოტო გვჭირდება",source:""},
    {state:"",text:"შენახული მონახაზი",source:"შეფუთვა"}
  ]},id:"id",batch:"batch",position:1,round:1,cardRevision:1,photoKinds:{},photoIds:[],revision:2,
    submitted:false,canWrite:true,locked:true,actor:"reviewer",at:new Date(),legacy:null};
  const before=JSON.stringify(row.response), [completed,,drafts]=pilotReport([row]);
  const evidence=drafts!.headers.indexOf(t("fields.evidence"));
  expect(completed!.rows).toHaveLength(0);
  expect(drafts!.rows[0]![evidence]).toBe([
    "ცნობილი კითხვა · პასუხი მაქვს · 100 ლ · ინსტრუქცია",
    "დასაზუსტებელი კითხვა · ჯერ ვერ ვადასტურებ · ფირფიტის ფოტო გვჭირდება",
    "უპასუხო კითხვა · პასუხი არ არის გაცემული · შენახული მონახაზი · შეფუთვა"
  ].join("\n"));
  expect(JSON.stringify(row.response)).toBe(before);
});
