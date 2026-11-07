import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { t } from "@khidi/i18n";
import { AvailabilityConfirmation, InventoryWorkspace } from "./inventory-workspace.tsx";
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:vi.fn()})}));
it("confirms the free-to-sell difference separately from protected quantities and exposes request-only wording",()=>{
  const html=renderToStaticMarkup(<AvailabilityConfirmation preview={{skuId:"fixture",target:10,previousAvailable:7,delta:3,reserved:3,committed:2}} busy={false} onConfirm={()=>{}} onCancel={()=>{}}/>);
  expect(html).toContain("7 → 10 (+3)");expect(html).toContain(t("inventory.protected"));expect(html).toContain(t("inventory.confirm"));
  const initial=renderToStaticMarkup(<InventoryWorkspace storefrontId="fixture" requests={[]} rows={[{skuId:"sku",code:"KH-999999",name:"Fixture",allocationId:null,availableToSell:0,reserved:0,committed:0,minimumStock:0,status:"NORMAL"}]}/>);
  expect(initial).toContain(t("inventory.undeclared"));expect(initial).toContain(t("inventory.risk"));expect(initial).toContain(t("inventory.preview"));
});
