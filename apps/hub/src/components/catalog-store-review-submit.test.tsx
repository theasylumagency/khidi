import { Children, isValidElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fieldKeys, startReview } from "@khidi/catalog-review/fields";
import { t } from "@khidi/i18n";
import { CatalogStoreReview } from "./catalog-store-review.tsx";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

// Exercise the real button handlers and save closure without a browser renderer.
// Initial state/ref values are real; effects and re-rendering are outside this test.
vi.mock("react", async importOriginal => {
  const react = await importOriginal<typeof import("react")>();
  return { ...react,
    useState<T>(initial?: T | (() => T)) {
      return [typeof initial === "function" ? (initial as () => T)() : initial, vi.fn()];
    },
    useRef<T>(initial: T) { return { current: initial }; },
    useEffect: vi.fn()
  };
});

type Props = ComponentProps<typeof CatalogStoreReview>;
type Row = Props["row"];
type Assortment = NonNullable<Row["response"]>["assortment"];
const original = { name: ["შემასხურებელი 400 ლ"], description: ["აღწერა"], facts: ["ავზი: 400 ლ"], kit: ["შლანგი"], links: [], photos: ["photo"] };
const questions = [{ field: "კომპლექტაცია", prompt: "რამდენი მეტრი შლანგი მოყვება?" }, { field: "თავსებადობა", prompt: "რას აბამთ?" }];
function row(assortment?: Assortment, complete = false): Row {
  const fields = startReview(original);
  if (complete) for (const k of fieldKeys) fields[k].verdict = "OK";
  return {
    id: "product", original, revision: 3, submitted: false, legacy: null, photoIds: ["photo"], photoKinds: { photo: "ILLUSTRATION" },
    card: { type: "მისაბმელიანი შემასხურებელი", questions },
    response: { fields, answers: questions.map(() => ({ state: complete ? "UNKNOWN" : "", text: "", source: "" })),
      suggestion: "saved suggestion", photoNote: "saved photo note", activeSeconds: 35,
      ...(assortment === undefined ? {} : { assortment }),
      ...(complete ? { mainPhoto: { photoId: "photo", checked: true, reason: "Reviewed illustration" } } : {}) }
  } as unknown as Row;
}

type ElementProps = { children?: ReactNode; onClick?: () => void };
function elements(node: ReactNode): ReactElement<ElementProps>[] {
  return Children.toArray(node).flatMap(child => isValidElement<ElementProps>(child)
    ? [child, ...elements(child.props.children)] : []);
}
function click(r: Row, label: string) {
  const tree = CatalogStoreReview({ row: r, photos: [{ id: "photo", url: "/photo", position: 1, kind: "ILLUSTRATION" }],
    peers: [], next: "next-product", old: { name: "", short: "", full: "" } });
  const button = elements(tree).find(e => e.type === "button" && e.props.children === label);
  expect(button?.props.onClick).toBeTypeOf("function");
  button!.props.onClick!();
}

const fetchMock = vi.fn<typeof fetch>();
const querySelector = vi.fn(() => null);
beforeEach(() => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ revision: 4 }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("document", { querySelector });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
});
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

it("submits a discontinued card with untouched fields, unanswered questions and an unconfirmed illustration", async () => {
  const r = row("DISCONTINUED");
  click(r, t("pilot.finish"));
  expect(fetchMock).toHaveBeenCalledOnce();
  const [url, request] = fetchMock.mock.calls[0]!;
  expect(url).toBe("/api/catalog-review/feedback");
  expect(request).toMatchObject({ method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": expect.any(String) } });
  expect(JSON.parse(request!.body as string)).toMatchObject({ productId: r.id, revision: 3, submit: true, response: r.response });
  expect(querySelector).not.toHaveBeenCalled();
  await vi.waitFor(() => {
    expect(router.push).toHaveBeenCalledWith("/review/next-product");
    expect(router.refresh).toHaveBeenCalledOnce();
  });
});

it("still directs an active unfinished card to its first unreviewed field", () => {
  click(row("ACTIVE"), t("pilot.finish"));
  expect(fetchMock).not.toHaveBeenCalled();
  expect(querySelector).toHaveBeenCalledWith('[data-field="name"] .store-strip');
  expect(router.push).not.toHaveBeenCalled();
});

it("still rejects a completed active card whose OK verdict disagrees with its edited value", () => {
  const r = row("ACTIVE", true);
  r.response!.fields.name.value = ["შეცვლილი სახელი"];
  click(r, t("pilot.finish"));
  expect(fetchMock).not.toHaveBeenCalled();
  expect(querySelector).toHaveBeenCalledWith('[data-field="name"] .store-strip');
});

it.each([undefined, ""] as const)("requires assortment when finishing an otherwise complete card with status %s", assortment => {
  click(row(assortment, true), t("pilot.finish"));
  expect(fetchMock).not.toHaveBeenCalled();
  expect(querySelector).toHaveBeenCalledWith("[data-assortment]");
});

it("saves an unfinished legacy draft without assortment and keeps the reviewer on the card", async () => {
  const r = row();
  click(r, t("pilot.draftSave"));
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toMatchObject({ productId: r.id, revision: 3, submit: false, response: r.response });
  await vi.waitFor(() => expect(router.refresh).toHaveBeenCalledOnce());
  expect(router.push).not.toHaveBeenCalled();
});

it("still rejects malformed field values on a discontinued card", () => {
  const r = row("DISCONTINUED");
  r.response!.fields.name.value = ["ერთი სახელი", "მეორე სახელი"];
  click(r, t("pilot.finish"));
  expect(fetchMock).not.toHaveBeenCalled();
  expect(querySelector).toHaveBeenCalledWith('[data-field="name"]');
});
