import { verifyStorefrontServiceCredential } from "@khidi/auth";
import { handleStorefrontApi, storefrontApiError } from "../../../../../../lib/storefront-api.ts";
import { assertStorefrontRequestHost } from "../../../../../../lib/host-isolation.ts";
const verify=(...args:Parameters<typeof verifyStorefrontServiceCredential>)=>verifyStorefrontServiceCredential(...args);
type Context={params:Promise<{store:string;resource:string[]}>};
export const dynamic="force-dynamic";
export async function GET(request:Request,context:Context){return handleStorefrontApi(request,await context.params,verify);}
export async function POST(request:Request,context:Context){return handleStorefrontApi(request,await context.params,verifyStorefrontServiceCredential);}
async function unsupported(request:Request){try{assertStorefrontRequestHost(request);return new Response(null,{status:405});}catch(error){return storefrontApiError(error);}}
export {unsupported as OPTIONS,unsupported as PUT,unsupported as PATCH,unsupported as DELETE};
