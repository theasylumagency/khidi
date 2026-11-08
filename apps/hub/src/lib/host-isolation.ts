import { isStorefrontApiHost } from "@khidi/shared/hosts";
import { AppError } from "@khidi/shared";
import { timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
export function assertHubRequestHost(request:Request) {
  if(isStorefrontApiHost(request)) throw new AppError("NOT_FOUND","Not found.");
}
export function assertStorefrontRequestHost(request:Request) {
  if(!isStorefrontApiHost(request)) throw new AppError("NOT_FOUND","Not found.");
  if(request.headers.has("origin")) throw new AppError("FORBIDDEN","Server-to-server requests required.");
}
/** The reverse proxy overwrites both headers; direct/untrusted IP headers have no authority. */
export function verifiedProxyClientIp(request:Request,env:NodeJS.ProcessEnv=process.env) {
  const expected=env.KHIDI_PROXY_TOKEN,provided=request.headers.get("x-khidi-proxy-token")??"";
  if(!expected || expected.length<32) return undefined;
  const a=Buffer.from(expected),b=Buffer.from(provided);
  if(a.length!==b.length || !timingSafeEqual(a,b))return undefined;
  const ip=request.headers.get("x-khidi-client-ip")??"";
  return isIP(ip) ? ip : undefined;
}
