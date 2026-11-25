import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { startReview, type Assessments } from "@khidi/catalog-review/fields";
import { t } from "@khidi/i18n";
import { CatalogStoreReview } from "./catalog-store-review.tsx";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

type Props = ComponentProps<typeof CatalogStoreReview>;
type Row = Props["row"];
const original = { name: ["შემასხურებელი 400 ლ"], description: ["აღწერა"], facts: ["ავზი: 400 ლ"], kit: ["შლანგი"], links: [], photos: [] };
const questions = [{ field: "კომპლექტაცია", prompt: "რამდენი მეტრი შლანგი მოყვება?" }, { field: "თავსებადობა", prompt: "რას აბამთ?" }];
const ok = (k: keyof Assessments) => ({ value: original[k], verdict: "OK" as const, reason: "", unknown: false });
const allOk = (): Assessments => ({ name: ok("name"), description: ok("description"), facts: ok("facts"), kit: ok("kit"), links: ok("links"), photos: ok("photos") });
type Answer = { state: "" | "KNOWN" | "UNKNOWN"; text: string; source: string };
const row = (fields: Assessments, answers: Answer[]): Row => ({
  id: "product", original, revision: 3, submitted: false, legacy: null, photoIds: [], photoKinds: {},
  card: { type: "მისაბმელიანი შემასხურებელი", questions },
  response: { fields, answers, suggestion: "", photoNote: "", layout: { order: ["description", "facts", "kit", "links"], missing: "" }, activeSeconds: 0 }
} as unknown as Row);
const render = (r: Row) => renderToStaticMarkup(createElement(CatalogStoreReview,
  { row: r, photos: [], peers: [], next: null, old: { name: "", short: "", full: "" } }));
const known = (text: string, source = "") => ({ state: "KNOWN" as const, text, source });

it("names every blocking field and question instead of one generic word", () => {
  const fields = { ...startReview(original), name: { ...ok("name"), verdict: "EDIT" as const, value: ["ახალი სახელი"] },
    kit: { ...startReview(original).kit, unknown: true } };
  const html = render(row(fields, [known("100 მეტრიანი შლანგი"), { state: "", text: "", source: "" }]));
  expect(html).toContain(t("store.left") + " 7");
  // An edit without a reason no longer blocks (owner decision 2026-11-25); the reason field stays available.
  expect(html).not.toContain(">" + t("pilot.target.name") + ": ");
  expect(html).toContain(t("store.reason"));
  expect(html).toContain(t("pilot.target.description") + ": " + t("store.problem.rate"));
  expect(html).toContain(t("pilot.target.kit") + ": " + t("store.problem.unknownOnly"));
  expect(html).toContain(t("store.question") + " 1: " + t("store.problem.answerSource"));
  expect(html).toContain(t("store.question") + " 2: " + t("store.problem.answerState"));
  expect(html).toContain('data-question="0" data-open="true"');
  expect(html).not.toContain(t("store.ready"));
});

it("keeps the finish button clickable so it can lead to the first open item", () => {
  const html = render(row(startReview(original), [known("კი", t("pilot.box")), known("ყველა მოტობლოკთან", t("pilot.experience"))]));
  const finish = html.match(/<button[^>]*>ბარათის დასრულება<\/button>/)?.[0] ?? "";
  expect(finish).toContain('aria-disabled="true"');
  expect(finish).not.toContain("disabled=\"\"");
});

it("reports a fully answered card as ready", () => {
  const html = render(row(allOk(), [known("კი", t("pilot.box")), { state: "UNKNOWN", text: "", source: "" }]));
  expect(html).toContain(t("store.ready"));
  expect(html).not.toContain(t("store.left"));
  expect(html).not.toContain("data-open");
});
