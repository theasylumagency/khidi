import { getDb } from "@agrotrade/db";
import { listEntityRelationships, listLegalEntities } from "@agrotrade/entities";

export const dynamic = "force-dynamic";

export default async function EntitiesPage() {
  const db = getDb();
  const entities = await listLegalEntities(db);
  const relationships = await listEntityRelationships(db);

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
          იურიდიული პირები და კომერციული ურთიერთობა (§4, C11, C17)
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
              <th style={{ padding: "0.6rem", borderBottom: "1px solid #cbd5e1" }}>სახელწოდება</th>
              <th style={{ padding: "0.6rem", borderBottom: "1px solid #cbd5e1" }}>ს/კ (Tax ID)</th>
              <th style={{ padding: "0.6rem", borderBottom: "1px solid #cbd5e1" }}>
                დღგ ნაგულისხმევად [C11]
              </th>
              <th style={{ padding: "0.6rem", borderBottom: "1px solid #cbd5e1" }}>სტატუსი</th>
            </tr>
          </thead>
          <tbody>
            {entities.map((entity) => (
              <tr key={entity.id}>
                <td style={{ padding: "0.6rem", borderBottom: "1px solid #e2e8f0", fontWeight: 600 }}>
                  {entity.key}
                </td>
                <td style={{ padding: "0.6rem", borderBottom: "1px solid #e2e8f0" }}>
                  {entity.legalName}
                </td>
                <td style={{ padding: "0.6rem", borderBottom: "1px solid #e2e8f0" }}>
                  <code>{entity.taxId}</code>
                </td>
                <td style={{ padding: "0.6rem", borderBottom: "1px solid #e2e8f0" }}>
                  {entity.pricesIncludeVat ? "დიახ (დღგ-ს ჩათვლით)" : "არა (დღგ-ს გარეშე)"}
                </td>
                <td style={{ padding: "0.6rem", borderBottom: "1px solid #e2e8f0" }}>
                  {entity.active ? "აქტიური" : "გათიშული"}
                </td>
              </tr>
            ))}
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
          სუბიექტთაშორისი კომერციული რეჟიმი (§4.4, C17)
        </h2>
        <p style={{ fontSize: "0.875rem", color: "#475569" }}>
          [C17] CONSIGNMENT → PURCHASE გადართვა იბლოკება, სანამ ჯვარედინ ალოკაციებზე არსებობს ღია რეზერვაცია ან ვალდებულება.
        </p>
        <ul style={{ fontSize: "0.9rem" }}>
          {relationships.map((rel) => (
            <li key={rel.id}>
              რეჟიმი: <strong>{rel.mode}</strong> · ძალაშია:{" "}
              <code>{rel.effectiveFrom.toISOString()}</code>{" "}
              {rel.notes ? `(${rel.notes})` : ""}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
