import Link from "next/link";
import { t, type NavItem, type TranslationKey } from "@khidi/i18n";
import { HubIcon } from "./hub-icon.tsx";
import { BridgeScene } from "./bridge-scene.tsx";

const shortcuts = ["products", "inventory", "prices", "tasks", "fulfillment", "reports"] as const;

export function WorkspaceOverview({ navigation, name, date, entities, storefronts, users, mode, admin }: {
  navigation: NavItem[]; name: string; date: string; entities: number; storefronts: number;
  users: number; mode: string | undefined; admin: boolean;
}) {
  const catalog = navigation.find(item => item.key === "products");
  const tasks = navigation.find(item => item.key === "tasks");
  const primary = catalog ?? navigation.find(item => item.key === "fulfillment") ?? tasks;
  const stats = [
    { icon: "storefronts", label: t("ui.storefronts"), value: storefronts, href: admin ? "/storefronts" : null },
    { icon: "legal_entities", label: t("ui.entities"), value: entities, href: admin ? "/entities" : null },
    ...(admin ? [{ icon: "users", label: t("users.title"), value: users, href: "/users" }] : [])
  ];
  return <div className="hub-stack hub-dashboard">
    <header className="hub-dashboard-header">
      <div><p className="hub-eyebrow">{t("ui.workspace")}</p><h1>{t("ui.greeting").replace("{name}", () => name)}</h1></div>
      <p className="hub-date"><HubIcon name="calendar" /><span>{date}</span></p>
    </header>
    <section className="hub-hero" aria-labelledby="hub-overview">
      <BridgeScene />
      <div className="hub-hero-content">
        <p className="hub-hero-label"><span />{t("ui.connected_workspace")}</p>
        <h2 id="hub-overview">{t("ui.hero_title")}<br /><em>{t("ui.hero_accent")}</em></h2>
        <p>{t("ui.hero_description")}</p>
        <div className="hub-hero-actions">
          {primary ? <Link href={primary.href} className="hub-hero-primary">{primary.labelKa}<HubIcon name="arrow" /></Link> : null}
          {tasks && tasks.key !== primary?.key ? <Link href={tasks.href} className="hub-hero-secondary">{tasks.labelKa}<HubIcon name="arrowUp" /></Link> : null}
        </div>
      </div>
      <div className="hub-hero-foot"><span>{t("ui.brand")}</span><span>{t("ui.hero_footnote")}</span><span className="hub-hero-coordinate" aria-hidden="true">01 — ∞</span></div>
    </section>
    <section className="hub-metrics" aria-label={t("ui.summary")}>
      {stats.map(stat => <div className="hub-metric" key={stat.icon}>
        <div className="hub-metric-label"><HubIcon name={stat.icon} /><span>{stat.label}</span></div>
        <div className="hub-metric-value"><strong>{String(stat.value).padStart(2, "0")}</strong>
          {stat.href ? <Link href={stat.href} aria-label={stat.label}><HubIcon name="arrowUp" /></Link> : null}</div>
      </div>)}
      <div className="hub-metric hub-metric-mode">
        <div className="hub-metric-label"><HubIcon name="security" /><span>{t("ui.commercial_mode")}</span></div>
        <strong>{mode ? t(mode === "PURCHASE" ? "inventory.mode.PURCHASE" : "inventory.mode.CONSIGNMENT") : t("ui.not_configured")}</strong>
        <span className="hub-mode-detail">{t("ui.mode_detail")}</span>
      </div>
    </section>
    <section className="hub-shortcuts" aria-labelledby="shortcut-title">
      <div className="hub-section-heading"><div><p className="hub-eyebrow">{t("ui.daily_work")}</p><h2 id="shortcut-title">{t("ui.shortcuts")}</h2></div><span>{t("ui.shortcuts_hint")}</span></div>
      <div className="hub-shortcut-grid">
        {shortcuts.map((key, index) => {
          const item = navigation.find(entry => entry.key === key);
          return item ? <Link key={key} href={item.href} className="hub-shortcut" data-kind={key}>
            <span className="hub-shortcut-top"><span className="hub-shortcut-icon"><HubIcon name={key} /></span><span className="hub-shortcut-index" aria-hidden="true">0{index + 1}</span></span>
            <strong>{item.labelKa}</strong><small>{t(`ui.shortcut.${key}` as TranslationKey)}</small>
            <span className="hub-shortcut-arrow"><HubIcon name="arrowUp" /></span>
          </Link> : null;
        })}
      </div>
    </section>
    <details className="hub-panel hub-operating-model">
      <summary>{t("settings.operating_model_title")}</summary>
      <ul>{[1, 2, 3].map(rule => <li key={rule}>{t(`settings.operating_model_rule${rule}` as TranslationKey)}</li>)}</ul>
    </details>
    <footer className="hub-workspace-footer"><span>{t("ui.brand")}<span aria-hidden="true"> / </span>{t("ui.workspace")}</span><span><HubIcon name="security" />{t("scanner.protected")}</span></footer>
  </div>;
}
