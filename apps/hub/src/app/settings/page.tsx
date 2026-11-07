import Link from "next/link";
import { t } from "@khidi/i18n";
import { getDb } from "@khidi/db";
import { getTechnicalSynonyms, listTechnicalTermGroups } from "@khidi/products";
import { requirePageAuth } from "../../lib/session.ts";
import { TechnicalSynonymsForm } from "../../components/technical-synonyms-form.tsx";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requirePageAuth({ allowedRoles: ["ADMIN"] });
  const terms = listTechnicalTermGroups(await getTechnicalSynonyms(getDb()))
    .map(({ group, unit, aliases }) => ({ group, unit, aliases }));

  return (
    <div style={{ display: "grid", gap: "1.5rem" }}>
      <TechnicalSynonymsForm terms={terms} />
      <section
        style={{
          background: "#ffffff",
          border: "1px solid #e2e8f0",
          borderRadius: "12px",
          padding: "1.5rem"
        }}
      >
        <h1 style={{ margin: "0 0 0.75rem 0", fontSize: "1.35rem" }}>
          {t("settings.operating_model_title", "ka")}
        </h1>
        <div
          style={{
            background: "#f8fafc",
            borderLeft: "4px solid #15803d",
            padding: "1rem 1.25rem",
            borderRadius: "8px",
            display: "grid",
            gap: "0.75rem",
            lineHeight: 1.6
          }}
        >
          <div>{t("settings.operating_model_rule1", "ka")}</div>
          <div>{t("settings.operating_model_rule2", "ka")}</div>
          <div>{t("settings.operating_model_rule3", "ka")}</div>
          <div>{t("inventory.counts_disabled")}</div>
          <Link href="/inventory">{t("inventory.title")}</Link>
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
          უსაფრთხოება და Concealment კონფიგურაცია (§4.3, §16.3, ADR-002, ADR-003)
        </h2>
        <ul style={{ margin: 0, paddingLeft: "1.25rem", lineHeight: 1.7, color: "#334155" }}>
          <li>
            <strong>X-Robots-Tag:</strong> <code>noindex, nofollow, noarchive, nosnippet</code>
          </li>
          <li>
            <strong>Access Gateway &amp; PWA:</strong> Manifest ჩართულია{" "}
            <code>crossorigin=&quot;use-credentials&quot;</code> ატრიბუტით, iOS{" "}
            <code>apple-touch-icon.png</code> (180x180) და განცალკევებული <code>any</code> /{" "}
            <code>maskable</code> PNG იკონებით ([C6]).
          </li>
          <li>
            <strong>DB Append-Only Immutability:</strong> <code>hub_app</code> როლს ჩამორთმეული აქვს{" "}
            <code>UPDATE</code> და <code>DELETE</code> უფლებები <code>audit_logs</code> და{" "}
            <code>outbox_events</code> ცხრილებზე ([C7]).
          </li>
          <li>
            <strong>TOTP &amp; Sessions:</strong> <code>totp_secret_encrypted</code> ინახება{" "}
            <code>AES-256-GCM</code> შიფრაციით; სესიები ინახება SHA-256 ჰეშით <code>sessions</code>{" "}
            ცხრილში; Service Worker ქეშავს მხოლოდ სტატიკურ ფაილებს და სუფთავდება გასვლისას (ADR-003).
          </li>
        </ul>
      </section>
    </div>
  );
}
