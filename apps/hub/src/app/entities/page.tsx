import { getDb } from "@khidi/db";
import { listLegalEntities, listEntityRelationships } from "@khidi/entities";
import { formatTbilisiDateTime } from "@khidi/shared";
import { requirePageAuth } from "../../lib/session.ts";

export const dynamic = "force-dynamic";

export default async function EntitiesPage() {
  await requirePageAuth({ allowedRoles: ["ADMIN"] });
  const db = getDb();
  const [entities, relationships] = await Promise.all([
    listLegalEntities(db),
    listEntityRelationships(db)
  ]);

  const entityMap = new Map(entities.map((e) => [e.id, e]));

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
          იურიდიული პირები (§4.1, [C11])
        </h1>
        <p style={{ margin: "0 0 1.25rem 0", color: "#475569", fontSize: "0.9rem" }}>
          თითოეულ იურიდიულ პირს აქვს საკუთარი საგადასახადო კოდი და დღგ-ს ნაგულისხმევი წესი (<code>prices_include_vat</code> [C11]), რომელიც ავტომატურად გადაეცემა მის ონლაინ მაღაზიებს.
        </p>

        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #cbd5e1", textAlign: "left" }}>
              <th style={{ padding: "0.75rem" }}>კოდი (Key)</th>
              <th style={{ padding: "0.75rem" }}>იურიდიული დასახელება</th>
              <th style={{ padding: "0.75rem" }}>ს/კ (Tax ID)</th>
              <th style={{ padding: "0.75rem" }}>დღგ რეჟიმი [C11]</th>
              <th style={{ padding: "0.75rem" }}>სტატუსი</th>
            </tr>
          </thead>
          <tbody>
            {entities.map((entity) => (
              <tr key={entity.id} style={{ borderBottom: "1px solid #e2e8f0" }}>
                <td style={{ padding: "0.75rem", fontWeight: 700 }}>
                  <code>{entity.key}</code>
                </td>
                <td style={{ padding: "0.75rem" }}>{entity.legalName}</td>
                <td style={{ padding: "0.75rem" }}>
                  <code>{entity.taxId}</code>
                </td>
                <td style={{ padding: "0.75rem" }}>
                  <span
                    style={{
                      padding: "0.2rem 0.6rem",
                      borderRadius: "999px",
                      fontSize: "0.8rem",
                      fontWeight: 600,
                      background: entity.pricesIncludeVat ? "#dbeafe" : "#fef3c7",
                      color: entity.pricesIncludeVat ? "#1e40af" : "#92400e"
                    }}
                  >
                    {entity.pricesIncludeVat
                      ? "დღგ-ს ჩათვლით (VAT Included)"
                      : "დღგ-ს გარეშე (Non-VAT)"}
                  </span>
                </td>
                <td style={{ padding: "0.75rem" }}>
                  {entity.active ? "აქტიური" : "არააქტიური"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section
        style={{
          background: "#ffffff",
          border: "1px solid #e2e8f0",
          borderRadius: "12px",
          padding: "1.5rem"
        }}
      >
        <h2 style={{ margin: "0 0 0.5rem 0", fontSize: "1.15rem" }}>
          კომერციული ურთიერთობის რეჟიმები (§4.4, [C17])
        </h2>
        <p style={{ margin: "0 0 1rem 0", color: "#475569", fontSize: "0.85rem" }}>
          <code>CONSIGNMENT -&gt; PURCHASE</code> გადასვლა დასაშვებია მხოლოდ მაშინ, როცა ჯვარედინ ალოკაციებზე ღია რეზერვაცია ან კომიტი არ არსებობს ([C17]).
        </p>

        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #cbd5e1", textAlign: "left" }}>
              <th style={{ padding: "0.75rem" }}>მომწოდებელი (From)</th>
              <th style={{ padding: "0.75rem" }}>მიმღები (To)</th>
              <th style={{ padding: "0.75rem" }}>რეჟიმი</th>
              <th style={{ padding: "0.75rem" }}>ძალაშია (Asia/Tbilisi)</th>
              <th style={{ padding: "0.75rem" }}>შენიშვნა</th>
            </tr>
          </thead>
          <tbody>
            {relationships.map((rel) => (
              <tr key={rel.id} style={{ borderBottom: "1px solid #e2e8f0" }}>
                <td style={{ padding: "0.75rem" }}>
                  <code>{entityMap.get(rel.fromEntityId)?.key ?? rel.fromEntityId}</code>
                </td>
                <td style={{ padding: "0.75rem" }}>
                  <code>{entityMap.get(rel.toEntityId)?.key ?? rel.toEntityId}</code>
                </td>
                <td style={{ padding: "0.75rem", fontWeight: 700 }}>{rel.mode}</td>
                <td style={{ padding: "0.75rem" }}>{formatTbilisiDateTime(rel.effectiveFrom)}</td>
                <td style={{ padding: "0.75rem", color: "#475569" }}>{rel.notes ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
