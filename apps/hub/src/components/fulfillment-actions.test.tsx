import { expect,it,vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { t } from "@khidi/i18n";
import { FulfillmentActions } from "./fulfillment-actions.tsx";
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:vi.fn()})}));
it("hides every stock action for simplified or closed requests",()=>{
  expect(renderToStaticMarkup(<FulfillmentActions id="fixture" canCancel={false} canMarkLost={false} lines={[]}/>)).toBe("");
  const manager=renderToStaticMarkup(<FulfillmentActions id="fixture" canCancel canMarkLost={false} lines={[]}/>);expect(manager).toContain(t("fulfillment.cancel"));expect(manager).not.toContain(t("fulfillment.lost"));
});
