import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { getNavigationForRole, t } from "@khidi/i18n";
import { WorkspaceOverview } from "./workspace-overview.tsx";

const props = { name: "$&", date: "15.11.2026", entities: 2, storefronts: 2, users: 3, mode: undefined, admin: false };

it("keeps order-manager shortcuts within the existing role navigation", () => {
  const html = renderToStaticMarkup(createElement(WorkspaceOverview, { ...props, navigation: getNavigationForRole("ORDER_MANAGER") }));
  expect(html).toContain('href="/fulfillment"');
  for (const path of ["/products", "/inventory", "/prices", "/users", "/entities", "/storefronts", "/diagnostics/pwa-spike"]) {
    expect(html).not.toContain(`href="${path}"`);
  }
  expect(html).toContain(t("ui.not_configured"));
  expect(html).not.toContain(t("inventory.mode.CONSIGNMENT"));
  expect(html).toContain("$&amp;");
});

it("honors granular report access and existing administrator management links", () => {
  const operator = renderToStaticMarkup(createElement(WorkspaceOverview, { ...props, navigation: getNavigationForRole("OPERATOR", ["reports.view"]) }));
  expect(operator).toContain('href="/reports"');
  expect(operator).not.toContain('href="/users"');
  const admin = renderToStaticMarkup(createElement(WorkspaceOverview, { ...props, admin: true, mode: "PURCHASE", navigation: getNavigationForRole("ADMIN") }));
  for (const path of ["/products", "/inventory", "/prices", "/users", "/entities", "/storefronts"]) expect(admin).toContain(`href="${path}"`);
  expect(admin).toContain(t("inventory.mode.PURCHASE"));
});
