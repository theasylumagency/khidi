import type { Metadata, Viewport } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { formatStaffName, getNavigationForRole, t, type TranslationKey } from "@khidi/i18n";
import { HubNavigation } from "../components/hub-navigation.tsx";
import { WorkspaceBar } from "../components/workspace-bar.tsx";
import { ScanQueueProvider } from "../components/scan-queue-provider.tsx";
import { PwaRegister } from "../components/pwa-register.tsx";
import { LogoutButton } from "../components/logout-button.tsx";
import { SessionIdleMonitor } from "../components/session-idle-monitor.tsx";
import { getCurrentPrincipal } from "../lib/session.ts";
import "../components/scanning.css";
import "./hub.css";
import "./signature.css";

export const metadata: Metadata = {
  title: "Khidi — სასაწყობო და კატალოგის ჰაბი",
  description: "Khidi — კანონიკური პროდუქტების, მარაგების, ფასებისა და შესრულების ცენტრი",
  robots: { index: false, follow: false }
};

export const viewport: Viewport = {
  themeColor: "#102f27",
  width: "device-width",
  initialScale: 1
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const principal = await getCurrentPrincipal();
  const navItems = principal ? getNavigationForRole(principal.role, principal.permissions) : [];

  return (
    <html lang="ka">
      <head>
        {/* [C6] crossorigin="use-credentials" ensures PWA manifest fetches pass Access Gateway cookies */}
        <link rel="manifest" href="/manifest.webmanifest" crossOrigin="use-credentials" />
        {/* iOS Home Screen PNG icon */}
        <link rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon.png" />
      </head>
      <body>
        <PwaRegister />
        {principal?.sessionTiming ? <SessionIdleMonitor key={principal.sessionId} timing={principal.sessionTiming} /> : null}
        <a className="hub-skip" href="#hub-content">{t("ui.skip")}</a>
        <div className={principal ? "hub-shell" : "hub-shell hub-shell-guest"}>
          {principal ? (
            <HubNavigation items={navItems} userId={principal.userId} name={formatStaffName(principal.fullName)}
              role={t(`scanning.role.${principal.role}` as TranslationKey)} diagnostics={principal.role === "ADMIN"}
              showSecurity={principal.authMethod !== "WAREHOUSE_PIN" && principal.role !== "WAREHOUSE"}
              logout={principal.sessionId ? <LogoutButton sessionId={principal.sessionId} /> : null}
            />
          ) : (
            <header className="hub-guest-header">
              <Link href="/login" className="hub-brand">
                <span className="hub-mark" aria-hidden="true" />
                <span>{t("ui.brand")}</span>
              </Link>
            </header>
          )}
          <main id="hub-content" className="hub-content" tabIndex={-1}>
            {principal ? <WorkspaceBar items={navItems} /> : null}
            <ScanQueueProvider user={principal ? { userId: principal.userId, fullName: principal.fullName, deviceId: principal.deviceId } : null}>
              {children}
            </ScanQueueProvider>
          </main>
        </div>
      </body>
    </html>
  );
}
