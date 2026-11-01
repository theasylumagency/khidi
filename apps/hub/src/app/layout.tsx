import type { Metadata } from "next";
import Link from "next/link";
import { NAVIGATION_ITEMS, t } from "@agrotrade/i18n";

export const metadata: Metadata = {
  title: "AgroTrade Hub — ონლაინ საწყობი",
  description: "შიდა ონლაინ საწყობის, კატალოგის, მარაგებისა და შესრულების მართვის სისტემა",
  robots: {
    index: false,
    follow: false
  }
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ka">
      <head>
        {/* [C6] ADR-002: Load manifest with use-credentials so Access Gateway cookies are sent */}
        <link
          rel="manifest"
          href="/manifest.webmanifest"
          crossOrigin="use-credentials"
        />
        <meta name="theme-color" content="#0f172a" />
      </head>
      <body
        style={{
          margin: 0,
          fontFamily: "'Noto Sans Georgian', system-ui, -apple-system, sans-serif",
          backgroundColor: "#f8fafc",
          color: "#0f172a"
        }}
      >
        <header
          style={{
            backgroundColor: "#0f172a",
            color: "#f8fafc",
            padding: "0.75rem 1.25rem",
            borderBottom: "2px solid #1e293b"
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: "0.75rem"
            }}
          >
            <div>
              <Link
                href="/"
                style={{
                  color: "#f8fafc",
                  textDecoration: "none",
                  fontWeight: 700,
                  fontSize: "1.05rem"
                }}
              >
                {t("app.title", "ka")}
              </Link>
              <span
                style={{
                  marginLeft: "0.75rem",
                  fontSize: "0.75rem",
                  backgroundColor: "#166534",
                  color: "#dcfce7",
                  padding: "0.15rem 0.5rem",
                  borderRadius: "4px"
                }}
              >
                INTERNAL HUB · NOINDEX
              </span>
            </div>
            <div style={{ display: "flex", gap: "0.75rem", fontSize: "0.85rem" }}>
              <Link
                href="/diagnostics/pwa-spike"
                style={{ color: "#38bdf8", textDecoration: "none", fontWeight: 600 }}
              >
                PWA & Gateway Spike [C6]
              </Link>
              <Link
                href="/settings"
                style={{ color: "#cbd5e1", textDecoration: "none" }}
              >
                ოპერაციული მოდელი
              </Link>
            </div>
          </div>

          <nav
            aria-label="მთავარი ნავიგაცია"
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "0.5rem 1rem",
              marginTop: "0.65rem",
              paddingTop: "0.5rem",
              borderTop: "1px solid #1e293b",
              fontSize: "0.875rem"
            }}
          >
            {NAVIGATION_ITEMS.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                style={{
                  color: item.adminOnly ? "#fcd34d" : "#e2e8f0",
                  textDecoration: "none",
                  fontWeight: 500
                }}
              >
                {item.labelKa}
              </Link>
            ))}
          </nav>
        </header>

        <main style={{ maxWidth: "1360px", margin: "0 auto", padding: "1.25rem" }}>
          {children}
        </main>
      </body>
    </html>
  );
}
