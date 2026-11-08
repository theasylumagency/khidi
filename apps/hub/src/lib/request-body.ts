import { readBoundedJson as readJson,readBoundedText as readText } from "@khidi/shared/input-limits";
import { assertSameSecurityOrigin,assertSecurityOrigin } from "./security-origin.ts";
export { parseBoundedObjectJson,CSV_BODY_BYTES } from "@khidi/shared/input-limits";
/** The private cookie-authenticated API requires browser origin proof as well as bounded bytes. */
export async function readBoundedJson(request:Request,maxBytes?:number) {
 assertSecurityOrigin(request);return readJson(request,maxBytes);
}
export async function readBoundedText(request:Request,maxBytes?:number) {
 assertSameSecurityOrigin(request);return readText(request,maxBytes);
}
