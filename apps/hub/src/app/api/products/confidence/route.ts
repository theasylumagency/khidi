import { NextResponse } from "next/server";
import { assertRoleAllowed } from "@khidi/auth";
import { t } from "@khidi/i18n";
import { getCurrentPrincipal } from "../../../../lib/session.ts";
import { scanningErrorResponse } from "../../../../lib/scanning-response.ts";

export async function POST() {
  try {
    const principal = await getCurrentPrincipal();
    if (!principal) return NextResponse.json({ error: t("scanning.error") }, { status: 401 });
    assertRoleAllowed(principal, ["ADMIN"]);
    return NextResponse.json({ error: t("evidence.computed_confidence") }, { status: 410 });
  } catch (error) { return scanningErrorResponse(error); }
}
