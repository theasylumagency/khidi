import Link from "next/link";
import { t } from "@agrotrade/i18n";

export default function HomePage() {
  return (
    <div style={{ display: "grid", gap: "1.25rem" }}>
      <section
        style={{
          backgroundColor: "#ffffff",
          border: "1px solid #cbd5e1",
          borderRadius: "6px",
          padding: "1.25rem"
        }}
      >
        <h1 style={{ margin: "0 0 0.5rem 0", fontSize: "1.35rem" }}>
          {t("app.title", "ka")}
        </h1>
        <p style={{ margin: 0, color: "#475569", fontSize: "0.95rem" }}>
          {t("app.subtitle", "ka")}
        </p>
      </section>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: "1rem"
        }}
      >
        <div
          style={{
            backgroundColor: "#ffffff",
            border: "1px solid #cbd5e1",
            borderRadius: "6px",
            padding: "1rem"
          }}
        >
          <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>
            1. იურიდიული პირები და მაღაზიები (§4, C11, C17)
          </h2>
          <p style={{ fontSize: "0.9rem", color: "#334155" }}>
            ორი იურიდიული პირი (<strong>AGROTRADE</strong> და <strong>NEWBRAND</strong>) საკუთარი დღგ-ს პარამეტრით (<code>prices_include_vat</code>) და კონფიგურირებადი ურთიერთობის რეჟიმით (<code>PURCHASE</code> | <code>CONSIGNMENT</code>).
          </p>
          <Link href="/settings" style={{ color: "#0284c7", fontWeight: 600, fontSize: "0.9rem" }}>
            ოპერაციული მოდელის და პარამეტრების ნახვა →
          </Link>
        </div>

        <div
          style={{
            backgroundColor: "#ffffff",
            border: "1px solid #cbd5e1",
            borderRadius: "6px",
            padding: "1rem"
          }}
        >
          <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>
            2. ავთენტიფიკაცია და როლები (§13, C12)
          </h2>
          <p style={{ fontSize: "0.9rem", color: "#334155" }}>
            ოფისის მომხმარებლები (Email + Password + სავალდებულო TOTP <code>ADMIN</code> და <code>STOCK_MANAGER</code> როლებისთვის) და საწყობის რეგისტრირებული ტელეფონის სწრაფი PIN გადართვა.
          </p>
        </div>

        <div
          style={{
            backgroundColor: "#ffffff",
            border: "1px solid #cbd5e1",
            borderRadius: "6px",
            padding: "1rem"
          }}
        >
          <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>
            3. Access Gateway + PWA Spike (§16.3, C6)
          </h2>
          <p style={{ fontSize: "0.9rem", color: "#334155" }}>
            რეალურ Android და iOS მოწყობილობებზე Gateway-ს უკან PWA ინსტალაციის, Service Worker-ის, კამერის, IndexedDB ოფლაინ რიგისა და Web Push-ის შემოწმება.
          </p>
          <Link
            href="/diagnostics/pwa-spike"
            style={{ color: "#0284c7", fontWeight: 600, fontSize: "0.9rem" }}
          >
            გახსენით PWA Spike დიაგნოსტიკა →
          </Link>
        </div>
      </section>
    </div>
  );
}
