import { listUsersWithMemberships } from "@agrotrade/auth";
import { getDb, registeredDevices } from "@agrotrade/db";
import { getRoleBadge } from "@agrotrade/ui";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const db = getDb();
  const userRows = await listUsersWithMemberships(db);
  const devices = await db.select().from(registeredDevices);

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
          მომხმარებლები, როლები და უფლებები (§13.1, §13.2, C12 / ADR-001)
        </h1>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: "0.9rem",
            marginTop: "0.75rem"
          }}
        >
          <thead>
            <tr style={{ backgroundColor: "#f1f5f9", textAlign: "left" }}>
              <th style={{ padding: "0.6rem", borderBottom: "1px solid #cbd5e1" }}>სახელი</th>
              <th style={{ padding: "0.6rem", borderBottom: "1px solid #cbd5e1" }}>ელ-ფოსტა</th>
              <th style={{ padding: "0.6rem", borderBottom: "1px solid #cbd5e1" }}>როლი</th>
              <th style={{ padding: "0.6rem", borderBottom: "1px solid #cbd5e1" }}>TOTP / PIN</th>
              <th style={{ padding: "0.6rem", borderBottom: "1px solid #cbd5e1" }}>
                დამატებითი უფლებები
              </th>
            </tr>
          </thead>
          <tbody>
            {userRows.map((u) => {
              const badge = getRoleBadge(u.role);
              return (
                <tr key={u.id}>
                  <td style={{ padding: "0.6rem", borderBottom: "1px solid #e2e8f0", fontWeight: 600 }}>
                    {u.fullName}
                  </td>
                  <td style={{ padding: "0.6rem", borderBottom: "1px solid #e2e8f0" }}>
                    <code>{u.email ?? "—"}</code>
                  </td>
                  <td style={{ padding: "0.6rem", borderBottom: "1px solid #e2e8f0" }}>
                    {badge.label}
                  </td>
                  <td style={{ padding: "0.6rem", borderBottom: "1px solid #e2e8f0" }}>
                    TOTP: {u.totpEnabled ? "ჩართულია" : "—"} · PIN: {u.hasPin ? "ჩართულია" : "—"}
                  </td>
                  <td style={{ padding: "0.6rem", borderBottom: "1px solid #e2e8f0" }}>
                    {u.permissions.length > 0 ? u.permissions.join(", ") : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section
        style={{
          backgroundColor: "#ffffff",
          border: "1px solid #cbd5e1",
          borderRadius: "6px",
          padding: "1.25rem"
        }}
      >
        <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>
          საწყობის რეგისტრირებული მოწყობილობები (§13.2)
        </h2>
        <ul style={{ fontSize: "0.9rem" }}>
          {devices.map((d) => (
            <li key={d.id}>
              <strong>{d.deviceName}</strong> — სტატუსი: {d.active ? "აქტიური" : "გაუქმებული"}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
