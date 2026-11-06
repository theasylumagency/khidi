import { expect, it } from "vitest";
import { webauthnConfig } from "./webauthn-config.ts";
const production = { NODE_ENV: "production", WEBAUTHN_RP_ID: "app.khidi.app", WEBAUTHN_ORIGIN: "https://app.khidi.app" };
it("accepts the fixed production RP/origin and isolated localhost development", () => {
  expect(webauthnConfig(production)).toMatchObject({ rpID: "app.khidi.app", origin: "https://app.khidi.app", recentWindowMs: 600000 });
  expect(webauthnConfig({ NODE_ENV: "test", WEBAUTHN_RP_ID: "localhost", WEBAUTHN_ORIGIN: "http://localhost:3100" }).rpID).toBe("localhost");
});
it.each([
  { ...production, WEBAUTHN_RP_ID: undefined }, { ...production, WEBAUTHN_ORIGIN: undefined },
  { ...production, WEBAUTHN_ORIGIN: "http://app.khidi.app" }, { ...production, WEBAUTHN_RP_ID: "khidi.app" },
  { ...production, WEBAUTHN_ORIGIN: "https://app.khidi.app.evil.example" }, { ...production, WEBAUTHN_ORIGIN: "https://app.khidi.app/path" },
  { ...production, AUTH_RECENT_WINDOW_SECONDS: "0" }, { ...production, AUTH_RECENT_WINDOW_SECONDS: "Infinity" },
  { ...production, AUTH_RECENT_WINDOW_SECONDS: "9999999" }
])("fails closed for invalid production configuration (%#)", (env) => expect(() => webauthnConfig(env)).toThrow(/^CRITICAL:/));
