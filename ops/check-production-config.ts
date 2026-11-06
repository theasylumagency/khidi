import { webauthnConfig } from "../packages/auth/src/webauthn-config.ts";
if (process.env.NODE_ENV !== "production") throw new Error("CRITICAL: Production preflight requires NODE_ENV=production.");
webauthnConfig();
console.log("Production WebAuthn configuration verified. No credentials were printed.");
