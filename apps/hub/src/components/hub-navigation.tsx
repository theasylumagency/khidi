"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState, type ReactNode } from "react";
import { t, type NavItem } from "@khidi/i18n";
import { NotificationBadge } from "./notification-badge.tsx";
import { HubIcon } from "./hub-icon.tsx";

export function HubNavigation({
  items, userId, name, role, showSecurity, logout, diagnostics
}: {
  items: NavItem[];
  userId: string;
  name: string;
  role: string;
  showSecurity: boolean;
  logout: ReactNode;
  diagnostics: boolean;
}) {
  const pathname = usePathname();
  const toggle = useRef<HTMLButtonElement>(null);
  const [openPath, setOpenPath] = useState<string | null>(null);
  const expanded = openPath === pathname;
  const current = items.find(({ href }) => pathname === href || pathname.startsWith(href + "/"));
  const work = items.filter((item) => !item.adminOnly || item.key === "evidence");
  const settings = items.filter((item) => item.adminOnly && item.key !== "evidence");
  const closeMenu = () => setOpenPath(null);

  function renderItem(item: NavItem) {
    return (
      <Link key={item.key} href={item.key === "evidence" ? "/evidence/missing" : item.href}
        aria-current={current?.key === item.key ? "page" : undefined} onClick={closeMenu}>
        <HubIcon name={item.key} /><span>{item.labelKa}</span>
        {item.key === "notifications" ? <NotificationBadge key={userId} /> : null}
      </Link>
    );
  }

  return (
    <header className="hub-sidebar" data-expanded={expanded} onKeyDown={(event) => {
      if (event.key === "Escape" && expanded) { closeMenu(); toggle.current?.focus(); }
    }}>
      <div className="hub-sidebar-top">
        <Link href="/" className="hub-brand" onClick={closeMenu}>
          <span className="hub-mark" aria-hidden="true" />
          <span>{t("ui.brand")}<small>{t("ui.workspace")}</small></span>
        </Link>
        <button ref={toggle} type="button" className="hub-menu-toggle" aria-controls="hub-menu"
          aria-expanded={expanded} onClick={() => setOpenPath(expanded ? null : pathname)}>
          <HubIcon name={expanded ? "close" : "menu"} />
          {t("ui.menu")}
        </button>
      </div>
      <div id="hub-menu" className="hub-menu">
        {items.some(item => item.key === "products") ? <form action="/products" className="hub-nav-search">
          <HubIcon name="search" />
          <input type="search" name="q" placeholder={t("ui.search_action")} aria-label={t("ui.search_placeholder")} />
          <button type="submit" aria-label={t("ui.search_action")}><HubIcon name="arrow" /></button>
        </form> : null}
        <nav className="hub-nav" aria-label={t("ui.navigation")}>
          <p className="hub-nav-caption">{t("ui.workspace")}</p>
          <Link href="/" aria-current={pathname === "/" ? "page" : undefined} onClick={closeMenu}>
            <HubIcon name="overview" /><span>{t("ui.overview")}</span>
          </Link>
          {work.map(renderItem)}
          {settings.length ? <p className="hub-nav-caption">{t("ui.administration")}</p> : null}
          {settings.map(renderItem)}
        </nav>
        <div className="hub-account">
          <div className="hub-profile">
            <span className="hub-avatar" aria-hidden="true">{name.trim().slice(0, 1)}</span>
            <div><strong>{name}</strong><small>{role}</small></div>
          </div>
          {showSecurity ? <Link href="/account/security" aria-current={pathname === "/account/security" ? "page" : undefined} onClick={closeMenu}><HubIcon name="security" />{t("passkey.security_title")}</Link> : null}
          {logout}
          {diagnostics ? <Link href="/diagnostics/pwa-spike" aria-current={pathname === "/diagnostics/pwa-spike" ? "page" : undefined} onClick={closeMenu}>{t("ui.diagnostics")}</Link> : null}
        </div>
      </div>
    </header>
  );
}
