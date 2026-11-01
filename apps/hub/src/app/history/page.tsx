import { getDb } from "@agrotrade/db";
import { listRecentAuditLogs } from "@agrotrade/domain";
import { formatTbilisiDateTime } from "@agrotrade/shared";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const db = getDb();
  const logs = await listRecentAuditLogs(db, 50);

  return (
    <div style={{ display: "grid", gap: "1.25rem" }}>
      <section
        style={{
          backgroundColor: "#ffffff",
          border: "1px solid #cbd5e1",
          borderRadius: "6px",
          padding: "1.25rem"
        }}
      >
        <h1 style={{ marginTop: 0, fontSize: "1.25rem" }}>
          აუდიტის უცვლელი ჟურნალი (§16.1, C7)
        </h1>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: "0.875rem",
            marginTop: "0.75rem"
          }}
        >
          <thead>
            <tr style={{ backgroundColor: "#f1f5f9", textAlign: "left" }}>
              <th style={{ padding: "0.5rem", borderBottom: "1px solid #cbd5e1" }}>
                დრო (Asia/Tbilisi)
              </th>
              <th style={{ padding: "0.5rem", borderBottom: "1px solid #cbd5e1" }}>ქმედება</th>
              <th style={{ padding: "0.5rem", borderBottom: "1px solid #cbd5e1" }}>ობიექტი</th>
              <th style={{ padding: "0.5rem", borderBottom: "1px solid #cbd5e1" }}>
                Correlation ID
              </th>
            </tr>
          </thead>
          <tbody>
            {logs.map((row) => (
              <tr key={row.id}>
                <td style={{ padding: "0.5rem", borderBottom: "1px solid #e2e8f0" }}>
                  {formatTbilisiDateTime(row.createdAt, "ka")}
                </td>
                <td style={{ padding: "0.5rem", borderBottom: "1px solid #e2e8f0", fontWeight: 600 }}>
                  <code>{row.action}</code>
                </td>
                <td style={{ padding: "0.5rem", borderBottom: "1px solid #e2e8f0" }}>
                  {row.entityType} · <code>{row.entityId}</code>
                </td>
                <td style={{ padding: "0.5rem", borderBottom: "1px solid #e2e8f0" }}>
                  <code>{row.correlationId}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
