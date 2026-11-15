import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb } from "@khidi/db";
import { listLegalEntities, listStorefronts, listEntityRelationships } from "@khidi/entities";
import { listUsersWithMemberships } from "@khidi/auth";
import { getNavigationForRole, t, type TranslationKey } from "@khidi/i18n";
import { requirePageAuth } from "../lib/session.ts";

export const dynamic = "force-dynamic";

const shortcuts = ["products", "inventory", "prices", "tasks", "fulfillment", "reports"] as const;

export default async function HomePage() {
  const principal = await requirePageAuth();
  if (principal.role === "WAREHOUSE") redirect("/warehouse/tasks");
  const db = getDb();

  const [entities, storefronts, relationships] = await Promise.all([
    listLegalEntities(db),
    listStorefronts(db),
    listEntityRelationships(db)
  ]);
  const admin = principal.role === "ADMIN";
  const users = admin ? await listUsersWithMemberships(db, principal) : [];
  const navigation = getNavigationForRole(principal.role, principal.permissions);

  return (
    <div className="hub-stack hub-dashboard">
      <section className="hub-hero" aria-labelledby="hub-overview">
        <div className="bridge-art" aria-hidden="true"><span /><i /></div>
        <div className="hub-hero-content">
          <p className="hub-hero-label">{t("ui.brand")} <span /> {t("ui.workspace")}</p>
          <h1 id="hub-overview">{t("ui.overview")}</h1>
          <p>{t("app.subtitle")}</p>
        </div>
      </section>

      <dl className="hub-summary" aria-label={t("ui.summary")}>
        <div>
          <dt>{t("ui.entities")}</dt>
          <dd>{entities.length}</dd>
          {admin ? <dd><Link href="/entities" aria-label={t("ui.entities")}>{t("ui.manage")} <span aria-hidden="true">↗</span></Link></dd> : null}
        </div>
        <div>
          <dt>{t("ui.storefronts")}</dt>
          <dd>{storefronts.length}</dd>
          {admin ? <dd><Link href="/storefronts" aria-label={t("ui.storefronts")}>{t("ui.manage")} <span aria-hidden="true">↗</span></Link></dd> : null}
        </div>
        {admin ? <div>
          <dt>{t("users.title")}</dt>
          <dd>{users.length}</dd>
          <dd><Link href="/users" aria-label={t("users.title")}>{t("ui.manage")} <span aria-hidden="true">↗</span></Link></dd>
        </div> : null}
        <div className="hub-summary-mode">
          <dt>{t("ui.commercial_mode")}</dt>
          <dd>{t(relationships[0]?.mode === "PURCHASE" ? "inventory.mode.PURCHASE" : "inventory.mode.CONSIGNMENT")}</dd>
          <dd><Link href="/diagnostics/pwa-spike">{t("ui.diagnostics")} <span aria-hidden="true">↗</span></Link></dd>
        </div>
      </dl>

      <section className="hub-shortcuts" aria-labelledby="shortcut-title">
        <h2 id="shortcut-title">{t("ui.shortcuts")}</h2>
        <div className="hub-shortcut-grid">
          {shortcuts.map((key) => {
            const item = navigation.find((entry) => entry.key === key);
            if (!item) return null;
            return (
              <Link key={key} href={item.href} className="hub-shortcut">
                <span className="hub-shortcut-icon" data-kind={key} aria-hidden="true" />
                <strong>{item.labelKa}</strong>
                <small>{t(`ui.shortcut.${key}` as TranslationKey)}</small>
                <span className="hub-shortcut-arrow" aria-hidden="true">↗</span>
              </Link>
            );
          })}
        </div>
      </section>

      <details className="hub-panel hub-operating-model">
        <summary>{t("settings.operating_model_title")}</summary>
        <ul>
          {[1, 2, 3].map((rule) => <li key={rule}>{t(`settings.operating_model_rule${rule}` as TranslationKey)}</li>)}
        </ul>
      </details>
    </div>
  );
}
