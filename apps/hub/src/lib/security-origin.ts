import { webauthnConfig } from "@khidi/auth/webauthn-config";
import { AppError } from "@khidi/shared";

export function assertSecurityOrigin(request: Request) {
  const config = webauthnConfig();
  const fetchSite = request.headers.get("sec-fetch-site");
  if (request.headers.get("origin") !== config.origin || (fetchSite && fetchSite !== "same-origin")
    || request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    throw new AppError("FORBIDDEN", "Same-origin JSON request required.");
  }
}
