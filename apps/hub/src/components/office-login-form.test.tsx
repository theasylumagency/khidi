import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { OfficeLoginForm } from "./office-login-form.tsx";
import { OfficePasswordField } from "./office-password-field.tsx";

function field(html: string, name: string) {
  const input = html.match(new RegExp(`<input\\b[^>]*\\bname="${name}"[^>]*>`, "u"))?.[0];
  expect(input).toBeDefined();
  return input!;
}

it("starts with a masked password and an accessible non-submit show action linked to the same field", () => {
  const html = renderToStaticMarkup(createElement(OfficePasswordField, { value: "", onChange: () => {} }));
  const password = field(html, "password");
  expect(password).toContain('type="password"');
  const id = password.match(/\bid="([^"]+)"/)![1];
  expect(html).toContain(`aria-controls="${id}"`);
  expect(html).toMatch(/<button type="button"[^>]*aria-label="პაროლის ჩვენება"/);
  expect(html).not.toContain("aria-pressed"); // Action label changes from show to hide.
});

it("keeps password-manager/autofill hints and disables mobile text correction on credentials", () => {
  const html = renderToStaticMarkup(createElement(OfficeLoginForm, { beforeLogin: async () => {} }));
  const email = field(html, "username"), password = field(html, "password");
  expect(email).toContain('type="email"'); expect(email).toContain('inputMode="email"');
  expect(email).toContain('autoComplete="username"');
  expect(password).toContain('autoComplete="current-password"');
  for (const input of [email, password]) {
    expect(input).toContain('autoCapitalize="none"'); expect(input).toContain('autoCorrect="off"');
    expect(input).toContain('spellCheck="false"'); expect(input).toContain('enterKeyHint="next"');
  }
});

it("uses six-digit text OTP entry with autofill, numeric keyboard and associated current-code guidance", () => {
  const html = renderToStaticMarkup(createElement(OfficeLoginForm, { beforeLogin: async () => {} }));
  const code = field(html, "totpCode");
  expect(code).toContain('type="text"'); // A number field would lose leading zeroes.
  expect(code).toContain('inputMode="numeric"'); expect(code).toContain('autoComplete="one-time-code"');
  expect(code).toContain('pattern="[0-9]{6}"'); expect(code).toContain('minLength="6"'); expect(code).toContain('maxLength="6"');
  expect(code).toContain('enterKeyHint="go"');
  const description = code.match(/aria-describedby="([^"]+)"/)![1];
  expect(html).toContain(`id="${description}"`);
  expect(html).toContain("თარიღისა და დროის ავტომატური გასწორება");
});
