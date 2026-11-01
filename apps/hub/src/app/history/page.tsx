import { getDb } from "@khidi/db";
import { listRecentAuditLogs } from "@khidi/domain";
import { formatTbilisiDateTime } from "@khidi/shared";
import { requirePageAuth } from "../../lib/session.ts";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  await requirePageAuth({ allowedRoles: ["ADMIN", "OPERATOR", "STOCK_MANAGER"] });
  const db = getDb();
  const logs = await listRecentAuditLogs(db, 30);

  return (
    <div style={{ display: "grid", gap: "1.5rem" }}>
      <section
        style={{
          background: "#ffffff",
          border: "1px solid #e2e8f0",
          borderRadius: "12px",
          padding: "1.5rem"
        }}
      >
        <h1 style={{ margin: "0 0 0.5rem 0", fontSize: "1.35rem" }}>
          უცვლელი აუდიტის ჟურნალი — Append-Only Audit Logs (§16.1, [C7])
        </h1>
        <p style={{ margin: "0 0 1.25rem 0", color: "#475569", fontSize: "0.9rem" }}>
          <code>audit_logs</code> ცხრილზე PostgreSQL ტრიგერითა და <code>hub_app</code> როლის უფლებებით სრულად აკრძალულია <code>UPDATE</code> და <code>DELETE</code> ოპერაციები ([C7]).
        </p>

        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #cbd5e1", textAlign: "left" }}>
              <th style={{ padding: "0.65rem" }}>დრო (Asia/Tbilisi)</th>
              <th style={{ padding: "0.65rem" }}>ქმედება (Action)</th>
              <th style={{ padding: "0.65rem" }}>ობიექტი</th>
              <th style={{ padding: "0.65rem" }}>Correlation ID</th>
              <th style={{ padding: "0.65rem" }}>After JSON</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id} style={{ borderBottom: "1px solid #e2e8f0" }}>
                <td style={{ padding: "0.65rem", whiteSpace: "nowrap" }}>
                  {formatTbilisiDateTime(log.createdAt)}
                </td>
                <td style={{ padding: "0.65rem", fontWeight: 700 }}>
                  <code>{log.action}</code>
                </td>
                <td style={{ padding: "0.65rem" }}>
                  <code>
                    {log.entityType}:{log.entityId}
                  </code>
                </td>
                <td style={{ padding: "0.65rem" }}>
                  <code>{log.correlationId}</code>
                </td>
                <td style={{ padding: "0.65rem", fontFamily: "monospace", fontSize: "0.78rem" }}>
                  {JSON.stringify(log.afterJson)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
