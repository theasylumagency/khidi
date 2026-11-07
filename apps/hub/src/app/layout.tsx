import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { ScanQueueProvider } from "../components/scan-queue-provider.tsx";
import "../components/scanning.css";
import type { ReactNode } from "react";
import { formatStaffName, getNavigationForRole, t, type TranslationKey } from "@khidi/i18n";
import { PwaRegister } from "../components/pwa-register.tsx";
import { LogoutButton } from "../components/logout-button.tsx";
import { SessionIdleMonitor } from "../components/session-idle-monitor.tsx";
import { getCurrentPrincipal } from "../lib/session.ts";

export const metadata: Metadata = {
  title: "Khidi — სასაწყობო და კატალოგის ჰაბი",
  description: "Khidi — კანონიკური პროდუქტების, მარაგების, ფასებისა და შესრულების ცენტრი",
  robots: {
    index: false,
    follow: false
  }
};

export const viewport: Viewport = {
  themeColor: "#15803d",
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
      <body
        style={{
          margin: 0,
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans Georgian', sans-serif",
          backgroundColor: "#f8fafc",
          color: "#0f172a"
        }}
      >
        <PwaRegister />
        {principal?.sessionTiming ? <SessionIdleMonitor key={principal.sessionId} timing={principal.sessionTiming} /> : null}
        <header
          style={{
            backgroundColor: "#0f172a",
            color: "#f8fafc",
            padding: "0.75rem 1.25rem",
            borderBottom: "2px solid #15803d"
          }}
        >
          <div
            style={{
              maxWidth: "1280px",
              margin: "0 auto",
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "1rem"
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
              <Link
                href={principal ? "/" : "/login"}
                style={{
                  color: "#ffffff",
                  textDecoration: "none",
                  fontWeight: 700,
                  fontSize: "1.1rem",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem"
                }}
              >
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "32px",
                    height: "32px",
                    borderRadius: "8px",
                    background: "#15803d",
                    color: "#fff",
                    fontWeight: 800,
                    fontSize: "0.85rem"
                  }}
                >
                  KH
                </span>
                <span>{t("app.title", "ka")}</span>
              </Link>
              {principal?.role === "ADMIN" && (
                <Link
                  href="/diagnostics/pwa-spike"
                  style={{
                    padding: "0.25rem 0.6rem",
                    borderRadius: "999px",
                    background: "#14532d",
                    color: "#bbf7d0",
                    fontSize: "0.75rem",
                    textDecoration: "none",
                    fontWeight: 600
                  }}
                >
                  PWA Spike [C6]
                </Link>
              )}
            </div>

            {principal ? (
              <nav
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "0.5rem",
                  alignItems: "center"
                }}
              >
                {navItems.map((item) => (
                  <Link
                    key={item.key}
                    href={item.href}
                    style={{
                      color: item.adminOnly ? "#fde047" : "#e2e8f0",
                      textDecoration: "none",
                      fontSize: "0.85rem",
                      padding: "0.35rem 0.6rem",
                      minHeight: "48px",
                      boxSizing: "border-box",
                      display: "inline-flex",
                      alignItems: "center",
                      borderRadius: "6px",
                      background: "rgba(255,255,255,0.06)"
                    }}
                  >
                    {item.labelKa}
                  </Link>
                ))}
                <span
                  style={{
                    padding: "0.25rem 0.55rem",
                    borderRadius: "6px",
                    background: "#1e293b",
                    color: "#86efac",
                    fontSize: "0.75rem",
                    fontWeight: 600
                  }}
                >
                  {formatStaffName(principal.fullName)} ({t(`scanning.role.${principal.role}` as TranslationKey)})
                </span>
                {principal.sessionId ? <LogoutButton sessionId={principal.sessionId} /> : null}
                {principal.authMethod !== "WAREHOUSE_PIN" && principal.role !== "WAREHOUSE" ? <Link href="/account/security" style={{ color: "#e2e8f0", padding: ".75rem" }}>{t("passkey.security_title")}</Link> : null}
              </nav>
            ) : (
              <div style={{ fontSize: "0.82rem", color: "#94a3b8" }}>
                {t("scanner.protected")}
              </div>
            )}
          </div>
        </header>
        <main style={{ maxWidth: "1280px", margin: "0 auto", padding: "1.5rem 1.25rem" }}>
          <ScanQueueProvider user={principal ? { userId: principal.userId, fullName: principal.fullName, deviceId: principal.deviceId } : null}>
            {children}
          </ScanQueueProvider>
        </main>
      </body>
    </html>
  );
}
