import { getDb } from "@khidi/db";
import { assertRoleAllowed } from "@khidi/auth";
import { getPrintableLabels } from "@khidi/scanning";
import { AppError } from "@khidi/shared";
import { getCurrentPrincipal } from "../../../../../lib/session.ts";
import { scanningErrorResponse } from "../../../../../lib/scanning-response.ts";

export async function GET(request: Request) {
  try {
    const principal = await getCurrentPrincipal();
    if (!principal) throw new AppError("UNAUTHORIZED", "Authentication required.");
    assertRoleAllowed(principal, ["ADMIN"]);
    const html = await getPrintableLabels(getDb(), principal, new URL(request.url).searchParams.getAll("intakeIds"));
    const printable = html.replace("</body>", '<script>window.addEventListener("load",function(){window.print()},{once:true});</script></body>');
    return new Response(printable, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" } });
  } catch (error) { return scanningErrorResponse(error); }
}
