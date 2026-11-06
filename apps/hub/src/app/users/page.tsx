import { getDb } from "@khidi/db";
import { listUsersWithMemberships } from "@khidi/auth";
import { listLegalEntities } from "@khidi/entities";
import { requirePageAuth, isSharedWarehouseBrowser } from "../../lib/session.ts";
import { RegisterDeviceButton } from "../../components/register-device-button.tsx";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const adminPrincipal = await requirePageAuth({ allowedRoles: ["ADMIN"] });
  const db = getDb();
  const [users, entities] = await Promise.all([
    listUsersWithMemberships(db, adminPrincipal),
    listLegalEntities(db)
  ]);

  const entityMap = new Map(entities.map((e) => [e.id, e.key]));

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
          მომხმარებლები, როლები და იურიდიული პირების წვდომა (§13.1, ADR-001 [C12])
        </h1>
        <p style={{ margin: "0 0 1.25rem 0", color: "#475569", fontSize: "0.9rem" }}>
          თითოეულ მომხმარებელს აქვს ერთი გლობალური როლი (<code>users.role</code>) და იურიდიული პირების წევრობა (<code>user_entity_memberships</code>). <code>ADMIN</code> და <code>STOCK_MANAGER</code> როლებისთვის TOTP 2FA სავალდებულოა (დაშიფრულია AES-256-GCM-ით).
        </p>

        <div
          style={{
            marginBottom: "1.25rem",
            padding: "1rem",
            borderRadius: "10px",
            background: "#f0fdf4",
            border: "1px solid #86efac"
          }}
        >
          <div style={{ fontWeight: 700, fontSize: "0.9rem", color: "#166534" }}>
            საწყობის ტერმინალის რეგისტრაცია (§13.2, ADR-003)
          </div>
          <div style={{ fontSize: "0.82rem", color: "#15803d", marginTop: "0.2rem" }}>
            დაარეგისტრირეთ მიმდინარე ბრაუზერი/ტელეფონი საწყობის ტერმინალად, რათა ამ მოწყობილობაზე ჩაირთოს პირადი PIN კოდით სწრაფი გადართვა:
          </div>
          <RegisterDeviceButton sharedDevice={await isSharedWarehouseBrowser()} />
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #cbd5e1", textAlign: "left" }}>
              <th style={{ padding: "0.75rem" }}>სახელი</th>
              <th style={{ padding: "0.75rem" }}>ელ-ფოსტა</th>
              <th style={{ padding: "0.75rem" }}>როლი [C12]</th>
              <th style={{ padding: "0.75rem" }}>იურიდიული პირები</th>
              <th style={{ padding: "0.75rem" }}>TOTP 2FA</th>
              <th style={{ padding: "0.75rem" }}>საწყობის PIN</th>
              <th style={{ padding: "0.75rem" }}>უფლებები</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} style={{ borderBottom: "1px solid #e2e8f0" }}>
                <td style={{ padding: "0.75rem", fontWeight: 600 }}>{u.fullName}</td>
                <td style={{ padding: "0.75rem" }}>
                  <code>{u.email}</code>
                </td>
                <td style={{ padding: "0.75rem" }}>
                  <span
                    style={{
                      padding: "0.2rem 0.55rem",
                      borderRadius: "6px",
                      background: "#0f172a",
                      color: "#f8fafc",
                      fontSize: "0.75rem",
                      fontWeight: 700
                    }}
                  >
                    {u.role}
                  </span>
                </td>
                <td style={{ padding: "0.75rem" }}>
                  {u.entityIds.map((eid) => entityMap.get(eid) ?? eid).join(", ")}
                </td>
                <td style={{ padding: "0.75rem" }}>
                  {u.totpEnabled ? "✓ ჩართული (AES-256-GCM)" : "—"}
                </td>
                <td style={{ padding: "0.75rem" }}>{u.hasPin ? "✓ აქტიური" : "—"}</td>
                <td style={{ padding: "0.75rem" }}>
                  {u.permissions.length > 0 ? <code>{u.permissions.join(", ")}</code> : "სტანდარტული"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
