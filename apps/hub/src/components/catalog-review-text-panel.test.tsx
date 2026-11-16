import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { t } from "@khidi/i18n";
import { CatalogReviewTextPanel } from "./catalog-review-text-panel.tsx";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));

const props: ComponentProps<typeof CatalogReviewTextPanel> = {
  productId: "product", field: "NAME", proposalId: "proposal", revision: 1, original: "",
  versions: [{ id: "edit", text: "რედაქტირებული 7 HP", label: "რედაქცია 1" },
    { id: "PROPOSAL", text: "თავდაპირველი 9 HP", label: "თავდაპირველი შეთავაზება" }],
  initialVersion: "edit", needsApproval: true, legacyApproval: false, stayHref: "/review/product?view=name"
};
const render = (overrides: Partial<typeof props> = {}) => renderToStaticMarkup(createElement(CatalogReviewTextPanel, { ...props, ...overrides }));

it("shows the selected edited text and a separate explicit approval action", () => {
  const html = render();
  expect(html).toContain('value="edit" selected=""');
  expect(html).toContain("რედაქტირებული 7 HP");
  expect(html).not.toContain("თავდაპირველი 9 HP");
  expect(html).toContain(t("review.edit_needs_approval"));
  expect(html).toContain(t("review.approve_text_version"));
});

it("offers entry for a missing field without an approval action or version selector", () => {
  const html = render({ proposalId: null, revision: 0, versions: [], initialVersion: undefined, needsApproval: false });
  expect(html).toContain(t("review.add_text"));
  expect(html).not.toContain('value="APPROVE"');
  expect(html).not.toContain("<select");
});

it("explains legacy approvals without implying that their version is known", () => {
  const html = render({ needsApproval: false, legacyApproval: true, initialVersion: "PROPOSAL" });
  expect(html).toContain(t("review.legacy_approval"));
  expect(html).toContain("თავდაპირველი 9 HP");
  expect(html).not.toContain("რედაქტირებული 7 HP");
});
