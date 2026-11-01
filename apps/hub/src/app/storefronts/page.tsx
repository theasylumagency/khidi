import { getDb } from "@agrotrade/db";
import { listStorefronts } from "@agrotrade/entities";

export const dynamic = "force-dynamic";

export default async function StorefrontsPage() {
  const db = getDb();
  const stores = await listStorefronts(db);

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
          მაღაზიები / სავაჭრო არხები (§4.2, §10.7, C11)
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
              <th style={{ padding: "0.6rem", borderBottom: "1px solid #cbd5e1" }}>კოდი</th>
              <th style={{ padding: "0.6rem", borderBottom: "1px solid #cbd5e1" }}>დომენი</th>
              <th style={{ padding: "0.6rem", borderBottom: "1px solid #cbd5e1" }}>
                გამყიდველი სუბიექტი
              </th>
              <th style={{ padding: "0.6rem", borderBottom: "1px solid #cbd5e1" }}>
                Media Host (§12.3)
              </th>
              <th style={{ padding: "0.6rem", borderBottom: "1px solid #cbd5e1" }}>
                დღგ ნაგულისხმევად [C11]
              </th>
            </tr>
          </thead>
          <tbody>
            {stores.map((s) => (
              <tr key={s.id}>
                <td style={{ padding: "0.6rem", borderBottom: "1px solid #e2e8f0", fontWeight: 600 }}>
                  {s.key}
                </td>
                <td style={{ padding: "0.6rem", borderBottom: "1px solid #e2e8f0" }}>
                  <code>{s.domain}</code>
                </td>
                <td style={{ padding: "0.6rem", borderBottom: "1px solid #e2e8f0" }}>
                  {s.sellerEntityKey} ({s.sellerEntityName})
                </td>
                <td style={{ padding: "0.6rem", borderBottom: "1px solid #e2e8f0" }}>
                  <code>{s.mediaBaseUrl}</code>
                </td>
                <td style={{ padding: "0.6rem", borderBottom: "1px solid #e2e8f0" }}>
                  {s.sellerPricesIncludeVat ? "დიახ" : "არა"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
