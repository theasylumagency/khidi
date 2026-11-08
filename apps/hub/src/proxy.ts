import { NextResponse, type NextRequest } from "next/server";
import { isStorefrontApiHost } from "@khidi/shared/hosts";

const PUBLIC_PATHS = new Set([
  "/login",
  "/api/health",
  "/manifest.webmanifest",
  "/sw.js",
  "/favicon.ico"
]);

export function isPublicRequestPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) {
    return true;
  }
  if (
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/icons/") ||
    pathname.startsWith("/_next/")
  ) {
    return true;
  }
  return false;
}

export function hasSessionCookieFormat(rawCookieValue: string | undefined): boolean {
  if (!rawCookieValue) {
    return false;
  }
  return (
    rawCookieValue.startsWith("khidi_sess_") ||
    rawCookieValue.startsWith("khidi_wsess_")
  );
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const servicePath=pathname.startsWith("/api/v1/storefront/");
  if(isStorefrontApiHost(request)) {
    if(!servicePath) return new NextResponse(null,{status:404});
    const response=NextResponse.next();response.headers.set("Cache-Control","no-store");return response;
  }
  if(servicePath) return new NextResponse(null,{status:404});

  if (isPublicRequestPath(pathname)) {
    return NextResponse.next();
  }

  const rawSession = request.cookies.get("khidi_session")?.value;
  if (!hasSessionCookieFormat(rawSession)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "UNAUTHORIZED", message: "Authentication required." },
        { status: 401 }
      );
    }

    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  const response = NextResponse.next();
  // Never allow browsers or shared phones to cache authenticated HTML or API responses
  response.headers.set("Cache-Control", "private, no-store, no-cache, must-revalidate");
  return response;
}

export const config = {
  matcher: ["/:path*"]
};
