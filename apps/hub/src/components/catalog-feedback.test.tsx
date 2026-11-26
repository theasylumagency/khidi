import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { PilotRow } from "@khidi/catalog-review";
import { originals, startReview } from "@khidi/catalog-review/fields";
import { t } from "@khidi/i18n";
import { PilotProduct, PilotResults } from "./catalog-feedback.tsx";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const card={wp:9,type:"type",name:"მონახაზი",description:"აღწერა",facts:[],kit:[],links:[],questions:[
  {field:"facts",prompt:"ცნობილი კითხვა"},{field:"facts",prompt:"დასაზუსტებელი კითხვა"},{field:"facts",prompt:"უპასუხო კითხვა"}
]};
const original=originals(card,[]);
const row:PilotRow={card,original,response:{fields:startReview(original),answers:[
  {state:"KNOWN",text:"100 ლ",source:"ინსტრუქცია"},
  {state:"UNKNOWN",text:"ფირფიტის ფოტო გვჭირდება",source:""},
  {state:"",text:"შენახული მონახაზი",source:"შეფუთვა"}
]},id:"product",batch:"batch",position:1,round:1,cardRevision:1,photoKinds:{},photoIds:[],revision:2,
  submitted:false,canWrite:true,locked:true,actor:"reviewer",at:new Date("2026-11-26T08:00:00Z"),legacy:null};
const closure={round:1,batchId:"batch",actor:"admin",note:"უკუკავშირი მიღებულია",submitted:0,drafts:1,untouched:19,
  createdAt:new Date("2026-11-26T09:00:00Z")};

it("distinguishes saved answers, explicit uncertainty and unanswered questions on a closed card and its results",()=>{
  const before=JSON.stringify(row.response);
  const result={product:{baseline:{}},photos:[],photoWork:[]} as unknown as ComponentProps<typeof PilotProduct>["result"];
  const cardHtml=renderToStaticMarkup(createElement(PilotProduct,{row,rows:[row],result}));
  const resultsHtml=renderToStaticMarkup(createElement(PilotResults,{rows:[row],details:{survey:null,decision:null,closure},admin:false,candidates:[],current:1}));
  for(const html of [cardHtml,resultsHtml]) {
    expect(html).toContain("<strong>ცნობილი კითხვა</strong><br/>პასუხი მაქვს · 100 ლ · ინსტრუქცია");
    expect(html).toContain("<strong>დასაზუსტებელი კითხვა</strong><br/>ჯერ ვერ ვადასტურებ · ფირფიტის ფოტო გვჭირდება");
    expect(html).toContain("<strong>უპასუხო კითხვა</strong><br/>პასუხი არ არის გაცემული · შენახული მონახაზი · შეფუთვა");
  }
  expect(cardHtml).toContain(t("pilot.closed"));
  expect(cardHtml).not.toContain(t("pilot.draftSave"));
  expect(resultsHtml).toContain('data-draft="true"');
  expect(JSON.stringify(row.response)).toBe(before);
});
