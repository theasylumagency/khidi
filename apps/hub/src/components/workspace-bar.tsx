"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { t, type NavItem } from "@khidi/i18n";
import { HubIcon } from "./hub-icon.tsx";

export function WorkspaceBar({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const current = items.find(item => pathname === item.href || pathname.startsWith(item.href + "/"));
  const label = current?.labelKa ?? (pathname.startsWith("/account") ? t("passkey.security_title") : t("ui.workspace"));
  return <div className="hub-workspace-bar">
    <nav aria-label={t("ui.navigation")}><Link href="/"><HubIcon name="overview" /><span>{t("ui.back_overview")}</span></Link>
      {pathname !== "/" ? <><HubIcon name="chevron" /><span>{label}</span></> : null}
    </nav>
    <span className="hub-private-label"><HubIcon name="security" />{t("scanner.protected")}</span>
  </div>;
}
