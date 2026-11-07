import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { CorrectionPriceImpactPanel } from "./correction-price-impact.tsx";
it("lists source withdrawals and warns only for targets without their own storefront price", () => {
  const html = renderToStaticMarkup(createElement(CorrectionPriceImpactPanel, {
    impact: { sourcePrices: [{ storefrontId: "store-a", storefrontName: "Store A", amount: 123450, vatIncluded: false }],
      pricedStorefrontsBySku: { priced: ["store-a"], unpriced: [] } },
    targets: [{ id: "priced", label: "Priced target" }, { id: "unpriced", label: "Unpriced target" }, { label: "New target" }]
  }));
  expect(html).toContain("1 234,50 ₾");
  expect(html.match(/role="alert"/g)).toHaveLength(2);
  expect(html).toContain("Unpriced target"); expect(html).toContain("New target");
  expect(html).not.toContain("Priced target");
  expect(html).toContain("ძველი ფასი მხოლოდ ინფორმაციისთვის");
});
