import { assertRoleAllowed } from "@khidi/auth";
import { getDb } from "@khidi/db";
import { listMissingEvidence } from "@khidi/evidence";
import { AppError } from "@khidi/shared";
import { getCurrentPrincipal } from "../../../../lib/session.ts";
import { scanningErrorResponse } from "../../../../lib/scanning-response.ts";

function cell(value: string) {
  const safe = /^[\s\uFEFF]*[=+@-]/.test(value) ? "'" + value : value;
  return '"' + safe.replaceAll('"', '""') + '"';
}

export async function GET(request: Request) {
  try {
    const principal = await getCurrentPrincipal();
    if (!principal) throw new AppError("UNAUTHORIZED", "Authentication required.");
    assertRoleAllowed(principal, ["ADMIN"]);
    const supplier = new URL(request.url).searchParams.get("supplier")?.trim().slice(0, 200);
    const rows = await listMissingEvidence(getDb(), { userId: principal.userId }, supplier);
    const csv = [["sku", "name", "supplier", "missing_fields", "missing_anchor", "reverification_required"],
      ...rows.map((row) => [row.internalSku, row.name ?? "", row.supplierNames.join(", "), row.missingFields.join(", "),
        String(row.missingAnchor), String(row.reverificationRequired)])].map((row) => row.map(cell).join(",")).join("\r\n");
    return new Response("\uFEFF" + csv, { headers: { "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="missing-evidence.csv"', "Cache-Control": "private, no-store" } });
  } catch (error) { return scanningErrorResponse(error); }
}
