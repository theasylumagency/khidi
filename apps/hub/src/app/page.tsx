import Link from "next/link";
import { getDb } from "@khidi/db";
import { listLegalEntities, listStorefronts, listEntityRelationships } from "@khidi/entities";
import { listUsersWithMemberships } from "@khidi/auth";
import { t } from "@khidi/i18n";
import { requirePageAuth } from "../lib/session.ts";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const principal = await requirePageAuth();
  const db = getDb();

  const [entities, storefronts, relationships] = await Promise.all([
    listLegalEntities(db),
    listStorefronts(db),
    listEntityRelationships(db)
  ]);

  const users =
    principal.role === "ADMIN" ? await listUsersWithMemberships(db, principal) : [];

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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h1 style={{ margin: "0 0 0.5rem 0", fontSize: "1.5rem" }}>
              {t("app.title", "ka")} — Milestone 1 (Foundation)
            </h1>
            <p style={{ margin: 0, color: "#475569" }}>{t("app.subtitle", "ka")}</p>
          </div>
          <span
            style={{
              background: "#dcfce7",
              color: "#166534",
              padding: "0.35rem 0.75rem",
              borderRadius: "999px",
              fontSize: "0.8rem",
              fontWeight: 700
            }}
          >
            PostgreSQL 18 + Append-Only [C7] Active
          </span>
        </div>

        <div
          style={{
            marginTop: "1.25rem",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "1rem"
          }}
        >
          <div
            style={{
              padding: "1rem",
              borderRadius: "10px",
              background: "#f8fafc",
              border: "1px solid #cbd5e1"
            }}
          >
            <div style={{ fontSize: "0.8rem", color: "#64748b" }}>იურიდიული პირები (§4.1, C11)</div>
            <div style={{ fontSize: "1.75rem", fontWeight: 800, marginTop: "0.25rem" }}>
              {entities.length}
            </div>
            {principal.role === "ADMIN" && (
              <Link href="/entities" style={{ fontSize: "0.85rem", color: "#15803d" }}>
                მართვა →
              </Link>
            )}
          </div>

          <div
            style={{
              padding: "1rem",
              borderRadius: "10px",
              background: "#f8fafc",
              border: "1px solid #cbd5e1"
            }}
          >
            <div style={{ fontSize: "0.8rem", color: "#64748b" }}>ონლაინ მაღაზიები (§4.2)</div>
            <div style={{ fontSize: "1.75rem", fontWeight: 800, marginTop: "0.25rem" }}>
              {storefronts.length}
            </div>
            {principal.role === "ADMIN" && (
              <Link href="/storefronts" style={{ fontSize: "0.85rem", color: "#15803d" }}>
                მართვა →
              </Link>
            )}
          </div>

          {principal.role === "ADMIN" && (
            <div
              style={{
                padding: "1rem",
                borderRadius: "10px",
                background: "#f8fafc",
                border: "1px solid #cbd5e1"
              }}
            >
              <div style={{ fontSize: "0.8rem", color: "#64748b" }}>
                მომხმარებლები და როლები (§13.1, C12)
              </div>
              <div style={{ fontSize: "1.75rem", fontWeight: 800, marginTop: "0.25rem" }}>
                {users.length}
              </div>
              <Link href="/users" style={{ fontSize: "0.85rem", color: "#15803d" }}>
                მართვა →
              </Link>
            </div>
          )}

          <div
            style={{
              padding: "1rem",
              borderRadius: "10px",
              background: "#f0fdf4",
              border: "1px solid #86efac"
            }}
          >
            <div style={{ fontSize: "0.8rem", color: "#166534" }}>
              კომერციული რეჟიმი (§4.4, C17)
            </div>
            <div style={{ fontSize: "1.35rem", fontWeight: 800, marginTop: "0.25rem" }}>
              {relationships[0]?.mode ?? "CONSIGNMENT"}
            </div>
            <Link href="/diagnostics/pwa-spike" style={{ fontSize: "0.85rem", color: "#15803d" }}>
              Access Gateway PWA Spike [C6] →
            </Link>
          </div>
        </div>
      </section>

      <section
        style={{
          background: "#ffffff",
          border: "1px solid #e2e8f0",
          borderRadius: "12px",
          padding: "1.5rem"
        }}
      >
        <h2 style={{ margin: "0 0 0.75rem 0", fontSize: "1.15rem" }}>
          {t("settings.operating_model_title", "ka")}
        </h2>
        <ul style={{ margin: 0, paddingLeft: "1.25rem", color: "#334155", lineHeight: 1.6 }}>
          <li>{t("settings.operating_model_rule1", "ka")}</li>
          <li>{t("settings.operating_model_rule2", "ka")}</li>
          <li>{t("settings.operating_model_rule3", "ka")}</li>
        </ul>
      </section>
    </div>
  );
}
