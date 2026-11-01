import { getDb } from "@khidi/db";
import { listStorefronts } from "@khidi/entities";
import { requirePageAuth } from "../../lib/session.ts";

export const dynamic = "force-dynamic";

export default async function StorefrontsPage() {
  await requirePageAuth({ allowedRoles: ["ADMIN"] });
  const db = getDb();
  const storefronts = await listStorefronts(db);

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
          ონლაინ მაღაზიები — Storefronts (§4.2, §4.3)
        </h1>
        <p style={{ margin: "0 0 1.25rem 0", color: "#475569", fontSize: "0.9rem" }}>
          თითოეული მაღაზია იღებს მხოლოდ საკუთარ ფასებს, ხელმისაწვდომობას და მისსავე <code>media_base_url</code>-ზე მიბმულ სურათების ბმულებს.
        </p>

        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #cbd5e1", textAlign: "left" }}>
              <th style={{ padding: "0.75rem" }}>კოდი (Key)</th>
              <th style={{ padding: "0.75rem" }}>დასახელება</th>
              <th style={{ padding: "0.75rem" }}>დომენი</th>
              <th style={{ padding: "0.75rem" }}>გამყიდველი იურ. პირი</th>
              <th style={{ padding: "0.75rem" }}>Media Base URL (§4.3)</th>
              <th style={{ padding: "0.75rem" }}>TTL პოლიტიკა (CARD / COD)</th>
            </tr>
          </thead>
          <tbody>
            {storefronts.map((sf) => (
              <tr key={sf.id} style={{ borderBottom: "1px solid #e2e8f0" }}>
                <td style={{ padding: "0.75rem", fontWeight: 700 }}>
                  <code>{sf.key}</code>
                </td>
                <td style={{ padding: "0.75rem" }}>{sf.name}</td>
                <td style={{ padding: "0.75rem" }}>
                  <code>{sf.domain}</code>
                </td>
                <td style={{ padding: "0.75rem" }}>
                  <code>{sf.sellerEntityKey}</code>{" "}
                  <span style={{ fontSize: "0.8rem", color: "#64748b" }}>
                    ({sf.sellerPricesIncludeVat ? "VAT incl." : "Non-VAT"})
                  </span>
                </td>
                <td style={{ padding: "0.75rem" }}>
                  <code>{sf.mediaBaseUrl}</code>
                </td>
                <td style={{ padding: "0.75rem", fontSize: "0.8rem" }}>
                  CARD: {sf.reservationPolicyJson.CARD}წმ / COD:{" "}
                  {sf.reservationPolicyJson.CASH_ON_DELIVERY}წმ
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
