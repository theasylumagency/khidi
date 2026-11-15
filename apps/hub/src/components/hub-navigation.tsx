"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { t, type NavItem } from "@khidi/i18n";
import { NotificationBadge } from "./notification-badge.tsx";

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
        <span>{item.labelKa}</span>
        {item.key === "notifications" ? <NotificationBadge key={userId} /> : null}
      </Link>
    );
  }

  return (
    <header className="hub-sidebar" data-expanded={expanded}>
      <div className="hub-sidebar-top">
        <Link href="/" className="hub-brand" onClick={closeMenu}>
          <span className="hub-mark" aria-hidden="true" />
          <span>{t("ui.brand")}</span>
        </Link>
        <button type="button" className="hub-menu-toggle" aria-controls="hub-menu"
          aria-expanded={expanded} onClick={() => setOpenPath(expanded ? null : pathname)}>
          <span className="hub-menu-icon" aria-hidden="true" />
          {t("ui.menu")}
        </button>
      </div>
      <div id="hub-menu" className="hub-menu">
        <nav className="hub-nav" aria-label={t("ui.navigation")}>
          <p className="hub-nav-caption">{t("ui.workspace")}</p>
          <Link href="/" aria-current={pathname === "/" ? "page" : undefined} onClick={closeMenu}>
            {t("ui.overview")}
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
          {showSecurity ? <Link href="/account/security" aria-current={pathname === "/account/security" ? "page" : undefined} onClick={closeMenu}>{t("passkey.security_title")}</Link> : null}
          {logout}
          {diagnostics ? <Link href="/diagnostics/pwa-spike" aria-current={pathname === "/diagnostics/pwa-spike" ? "page" : undefined} onClick={closeMenu}>{t("ui.diagnostics")}</Link> : null}
        </div>
      </div>
    </header>
  );
}
