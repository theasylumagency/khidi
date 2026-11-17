import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { LoginForms } from "./login-forms.tsx";

// Exercise the capability effect in this DOM-free renderer. Native browser/phone
// prompts and hydration still require the physical-device acceptance check.
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return { ...react, useEffect(effect: () => unknown) {
    const [ran, setRan] = react.useState(false);
    if (!ran) { setRan(true); effect(); }
  } };
});

afterEach(() => vi.unstubAllGlobals());

function render(props: Partial<Parameters<typeof LoginForms>[0]> = {}, supported = true, secure = true) {
  vi.stubGlobal("window", { isSecureContext: secure });
  // No platform-authenticator capability: phones must remain an option.
  vi.stubGlobal("PublicKeyCredential", supported ? class {} : undefined);
  vi.stubGlobal("navigator", { credentials: { get() {} } });
  return renderToStaticMarkup(createElement(LoginForms, { registeredDevice: null, pinUsers: [], ...props }));
}

it("offers quick sign-in and collapsed phone help without any remembered account", () => {
  const html = render();
  expect(html).toContain('<button class="auth-secondary" type="button">სწრაფი შესვლა</button>');
  expect(html).toContain('<button class="auth-primary" type="button">პაროლით შესვლა</button>');
  expect(html).toContain('<details class="auth-help"><summary>როგორ შევიდე ტელეფონით?</summary>');
  expect(html).toContain("Bluetooth");
});

it("keeps remembered quick sign-in primary and the consented name greeting", () => {
  const html = render({ quickSignInPreferred: true, firstName: "ლიკა" });
  expect(html).toContain('<button class="auth-primary" type="button">სწრაფი შესვლა</button>');
  expect(html).toContain('<button class="auth-secondary" type="button">პაროლით შესვლა</button>');
  expect(html).toContain("ლიკა");
});

it.each([
  { sharedWarehouseDevice: true },
  { registeredDevice: { id: "fixture", deviceName: "Shared fixture" }, pinUsers: [{ id: "operator", fullName: "Operator fixture" }] }
])("keeps passkeys and phone help unavailable on shared warehouse browsers", props => {
  const html = render({ ...props, quickSignInPreferred: true, firstName: "ლიკა" });
  expect(html).not.toContain("სწრაფი შესვლა");
  expect(html).not.toContain("როგორ შევიდე ტელეფონით?");
  expect(html).not.toContain("ლიკა");
});

it.each([[false, true], [true, false]])("retains ordinary sign-in when WebAuthn or a secure context is unavailable", (supported, secure) => {
  const html = render({ quickSignInPreferred: true }, supported, secure);
  expect(html).not.toContain("სწრაფი შესვლა");
  expect(html).toContain('<button class="auth-primary" type="button">შესვლა</button>');
});
