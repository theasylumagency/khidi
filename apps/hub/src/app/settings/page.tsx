import { t } from "@agrotrade/i18n";

export default function SettingsPage() {
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
        <h1 style={{ marginTop: 0, fontSize: "1.25rem" }}>
          პარამეტრები და ოპერაციული მოდელი (§10.1, C1, C13)
        </h1>
        <p style={{ color: "#334155", fontSize: "0.95rem" }}>
          {t("settings.operating_model_title", "ka")}
        </p>

        <ul style={{ lineHeight: 1.65, color: "#1e293b", fontSize: "0.925rem" }}>
          <li>{t("settings.operating_model_rule1", "ka")}</li>
          <li>{t("settings.operating_model_rule2", "ka")}</li>
          <li>{t("settings.operating_model_rule3", "ka")}</li>
          <li>
            4. ყოველდღიური მოძრაობის რეპორტები (CSV/XLSX) ექსპორტდება თითოეული იურიდიული პირის ბუღალტრისთვის COMMIT დროს ჩაწერილი ბუღალტრული მეპინგის snapshot-ით [C18].
          </li>
          <li>
            5. პერიოდული ინვენტარიზაცია (PHYSICAL_COUNT) ითვლის თითოეულ პულს ცალ-ცალკე, SHELF და STAGING ზონების იზოლირებული შედარებით (§10.11, [C13]).
          </li>
        </ul>
      </section>
    </div>
  );
}
