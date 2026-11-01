import { t } from "@agrotrade/i18n";

export default function LoginPage() {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
        gap: "1.25rem"
      }}
    >
      <section
        style={{
          backgroundColor: "#ffffff",
          border: "1px solid #cbd5e1",
          borderRadius: "6px",
          padding: "1.25rem"
        }}
      >
        <h1 style={{ marginTop: 0, fontSize: "1.15rem" }}>
          {t("auth.office_login", "ka")}
        </h1>
        <p style={{ fontSize: "0.875rem", color: "#475569" }}>
          ADMIN და STOCK_MANAGER როლებისთვის TOTP 6-ნიშნა კოდი სავალდებულოა (§13.2).
        </p>
        <div style={{ display: "grid", gap: "0.75rem", marginTop: "1rem" }}>
          <label style={{ display: "grid", gap: "0.25rem", fontSize: "0.875rem" }}>
            <span>ელ-ფოსტა</span>
            <input
              type="email"
              defaultValue="admin@agrotrade.local"
              readOnly
              style={{ padding: "0.5rem", borderRadius: "4px", border: "1px solid #cbd5e1" }}
            />
          </label>
          <label style={{ display: "grid", gap: "0.25rem", fontSize: "0.875rem" }}>
            <span>TOTP კოდი (6 ციფრი)</span>
            <input
              type="text"
              placeholder="000000"
              readOnly
              style={{ padding: "0.5rem", borderRadius: "4px", border: "1px solid #cbd5e1" }}
            />
          </label>
        </div>
      </section>

      <section
        style={{
          backgroundColor: "#ffffff",
          border: "1px solid #cbd5e1",
          borderRadius: "6px",
          padding: "1.25rem"
        }}
      >
        <h2 style={{ marginTop: 0, fontSize: "1.15rem" }}>
          {t("auth.warehouse_pin", "ka")}
        </h2>
        <p style={{ fontSize: "0.875rem", color: "#475569" }}>
          საწყობის რეგისტრირებულ ტელეფონზე პერსონალური PIN-ით სწრაფი გადართვა (§13.2).
        </p>
        <div style={{ display: "grid", gap: "0.75rem", marginTop: "1rem" }}>
          <div
            style={{
              padding: "0.65rem",
              backgroundColor: "#f8fafc",
              border: "1px solid #e2e8f0",
              borderRadius: "4px",
              fontSize: "0.9rem"
            }}
          >
            მოწყობილობა: <strong>Warehouse Scanner #1 (Zebra/Android)</strong>
          </div>
          <label style={{ display: "grid", gap: "0.25rem", fontSize: "0.875rem" }}>
            <span>პერსონალური PIN</span>
            <input
              type="password"
              placeholder="••••"
              readOnly
              style={{
                padding: "0.65rem",
                fontSize: "1.1rem",
                letterSpacing: "0.25rem",
                borderRadius: "4px",
                border: "1px solid #cbd5e1"
              }}
            />
          </label>
        </div>
      </section>
    </div>
  );
}
