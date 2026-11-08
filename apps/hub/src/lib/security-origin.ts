import { webauthnConfig } from "@khidi/auth/webauthn-config";
import { AppError } from "@khidi/shared";
import { assertHubRequestHost } from "./host-isolation.ts";

export function assertSameSecurityOrigin(request: Request) {
  assertHubRequestHost(request);
  const config = webauthnConfig();
  const fetchSite = request.headers.get("sec-fetch-site");
  if (request.headers.get("origin") !== config.origin || (fetchSite && fetchSite !== "same-origin")) {
    throw new AppError("FORBIDDEN", "Same-origin request required.");
  }
}

export function assertSecurityOrigin(request: Request) {
  assertSameSecurityOrigin(request);
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    throw new AppError("FORBIDDEN", "Same-origin JSON request required.");
  }
}
