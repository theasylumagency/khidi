import Link from "next/link";
import { getDb } from "@khidi/db";
import { t } from "@khidi/i18n";
import {
  listCategories,
  listLegacyUrls,
  listProductTypes,
  listSkusWorkspace
} from "@khidi/products";
import { requirePageAuth } from "../../lib/session.ts";
import { ProductCreateForm } from "../../components/product-create-form.tsx";

export const dynamic = "force-dynamic";

export default async function ProductsWorkspacePage({ searchParams }: {
  searchParams: Promise<{ q?: string | string[]; english?: string | string[] }>;
}) {
  const principal = await requirePageAuth({
    allowedRoles: ["ADMIN", "OPERATOR", "STOCK_MANAGER"]
  });

  const db = getDb();
  const [skus, categories, productTypes, legacyUrls, filters] = await Promise.all([
    listSkusWorkspace(db),
    listCategories(db),
    listProductTypes(db),
    listLegacyUrls(db), searchParams
  ]);

  const canCreateSku = principal.role === "ADMIN" || principal.role === "OPERATOR";
  const search = typeof filters.q === "string" ? filters.q.trim() : "";
  const query = search.toLowerCase();
  const readyWithoutEnglish = filters.english === "ready-without-approval";
  const visibleSkus = skus.filter((sku) => {
    if (readyWithoutEnglish && (sku.lifecycleState !== "READY" || sku.englishContentStatus === "approved")) return false;
    return !query || [sku.internalSku, sku.displayNameKa, sku.displayNameEn, sku.modelCode,
      ...(sku.searchAliasesKa ?? []), ...(sku.searchAliasesEn ?? [])].some((value) => value?.toLowerCase().includes(query));
  });

  return (
    <div style={{ display: "grid", gap: "1.5rem" }}>
      {principal.role==="ADMIN"?<Link href="/products/configuration">{t("setup.subtypes")}</Link>:null}
      {/* Header & Summary */}
      <section
        style={{
          background: "#ffffff",
          border: "1px solid #e2e8f0",
          borderRadius: "12px",
          padding: "1.5rem"
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h1 style={{ margin: "0 0 0.4rem 0", fontSize: "1.45rem" }}>
              {t("content.catalog")}
            </h1>
          </div>
        </div>

        <div
          style={{
            marginTop: "1.1rem",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
            gap: "0.9rem"
          }}
        >
          <div
            style={{
              padding: "0.9rem",
              borderRadius: "10px",
              background: "#f8fafc",
              border: "1px solid #cbd5e1"
            }}
          >
            <div style={{ fontSize: "0.78rem", color: "#64748b" }}>სულ SKU / ვარიანტი</div>
            <div style={{ fontSize: "1.6rem", fontWeight: 800, marginTop: "0.2rem" }}>
              {skus.length}
            </div>
          </div>
          <div
            style={{
              padding: "0.9rem",
              borderRadius: "10px",
              background: "#f8fafc",
              border: "1px solid #cbd5e1"
            }}
          >
            <div style={{ fontSize: "0.78rem", color: "#64748b" }}>კატეგორიები (§5.7)</div>
            <div style={{ fontSize: "1.6rem", fontWeight: 800, marginTop: "0.2rem" }}>
              {categories.filter((c) => !c.isUnclassified).length} + 1 UNCLASSIFIED
            </div>
          </div>
          <div
            style={{
              padding: "0.9rem",
              borderRadius: "10px",
              background: "#f8fafc",
              border: "1px solid #cbd5e1"
            }}
          >
            <div style={{ fontSize: "0.78rem", color: "#64748b" }}>პროდუქტის ტიპები (§5.8)</div>
            <div style={{ fontSize: "1.6rem", fontWeight: 800, marginTop: "0.2rem" }}>
              {productTypes.length}
            </div>
          </div>
          <div
            style={{
              padding: "0.9rem",
              borderRadius: "10px",
              background: "#f8fafc",
              border: "1px solid #cbd5e1"
            }}
          >
            <div style={{ fontSize: "0.78rem", color: "#64748b" }}>Legacy SEO URL-ები (§12.5)</div>
            <div style={{ fontSize: "1.6rem", fontWeight: 800, marginTop: "0.2rem" }}>
              {legacyUrls.length}
            </div>
          </div>
        </div>
      </section>

      {/* Quick Create SKU Draft Form */}
      {canCreateSku && (
        <section
          style={{
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: "12px",
            padding: "1.25rem 1.5rem"
          }}
        >
          <h2 style={{ margin: "0 0 0.75rem 0", fontSize: "1.05rem" }}>
            ახალი SKU Draft-ის დამატება (`INTAKE`, `canonical_slug = NULL` [C8])
          </h2>
          <ProductCreateForm productTypes={productTypes} />
        </section>
      )}

      {/* Desktop Products Workspace Table (§15.4) */}
      <section
        style={{
          background: "#ffffff",
          border: "1px solid #e2e8f0",
          borderRadius: "12px",
          padding: "1.5rem",
          overflowX: "auto"
        }}
      >
        <h2 style={{ margin: "0 0 1rem 0", fontSize: "1.1rem" }}>
          {t("content.catalog_table")}
        </h2>
        <form action="/products" style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginBottom: "1rem" }}>
          <label>{t("content.search")} <input type="search" name="q" defaultValue={search} /></label>
          <label><input type="checkbox" name="english" value="ready-without-approval" defaultChecked={readyWithoutEnglish} /> {t("content.ready_without_en")}</label>
          <button type="submit">{t("content.apply_filters")}</button>
        </form>
        {visibleSkus.length === 0 ? <p>{t("content.no_matches")}</p> : null}

        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: "0.84rem"
          }}
        >
          <thead>
            <tr style={{ borderBottom: "2px solid #cbd5e1", textAlign: "left" }}>
              <th style={{ padding: "0.6rem" }}>SKU (§5.4)</th>
              <th style={{ padding: "0.6rem" }}>პროდუქტი / დეტერმინისტული სახელი (§5.10)</th>
              <th style={{ padding: "0.6rem" }}>ტიპი & კატეგორია</th>
              <th style={{ padding: "0.6rem" }}>სტატუსი & სლაგი ([C8])</th>
              <th scope="col" style={{ padding: "0.6rem" }}>{t("content.english_status")}</th>
              <th style={{ padding: "0.6rem" }}>ერთეულები (§5.6)</th>
              <th style={{ padding: "0.6rem" }}>ბუღალტრული მეპინგი ([C9])</th>
              <th style={{ padding: "0.6rem" }}>მაღაზიები (§4.5)</th>
              <th style={{ padding: "0.6rem" }}>ეტიკეტი</th>
            </tr>
          </thead>
          <tbody>
            {visibleSkus.map((sku) => (
              <tr key={sku.id} style={{ borderBottom: "1px solid #e2e8f0" }}>
                <td style={{ padding: "0.65rem", fontFamily: "monospace", fontWeight: 700 }}>
                  <Link href={`/products/${sku.id}`} style={{ color: "#15803d" }}>
                    {sku.internalSku}
                  </Link>
                  <div style={{ display: "flex", gap: "0.3rem", marginTop: "0.25rem" }}>
                    {sku.isComposedBundle && (
                      <span
                        style={{
                          background: "#dbeafe",
                          color: "#1e40af",
                          padding: "0.1rem 0.4rem",
                          borderRadius: "4px",
                          fontSize: "0.7rem",
                          fontWeight: 700
                        }}
                      >
                        BUNDLE
                      </span>
                    )}
                    {sku.isKit && (
                      <span
                        style={{
                          background: "#fef3c7",
                          color: "#92400e",
                          padding: "0.1rem 0.4rem",
                          borderRadius: "4px",
                          fontSize: "0.7rem",
                          fontWeight: 700
                        }}
                      >
                        FACTORY KIT
                      </span>
                    )}
                    {sku.hasIdentifierCollision && (
                      <span
                        style={{
                          background: "#fee2e2",
                          color: "#991b1b",
                          padding: "0.1rem 0.4rem",
                          borderRadius: "4px",
                          fontSize: "0.7rem",
                          fontWeight: 700
                        }}
                      >
                        ⚠ კოლიზია
                      </span>
                    )}
                  </div>
                </td>

                <td style={{ padding: "0.65rem" }}>
                  <div style={{ fontWeight: 700 }}>
                    {sku.displayNameKa ?? sku.modelCode ?? "დაუდგენელი პროდუქტი"}
                  </div>
                  {sku.displayNameEn && (
                    <div style={{ fontSize: "0.76rem", color: "#64748b" }}>{sku.displayNameEn}</div>
                  )}
                </td>

                <td style={{ padding: "0.65rem" }}>
                  <div style={{ fontWeight: 600 }}>{sku.productTypeNameKa}</div>
                  <div style={{ fontSize: "0.75rem", color: "#64748b" }}>{sku.categoryNameKa}</div>
                </td>

                <td style={{ padding: "0.65rem" }}>
                  <span
                    style={{
                      display: "inline-block",
                      padding: "0.15rem 0.5rem",
                      borderRadius: "999px",
                      fontSize: "0.74rem",
                      fontWeight: 700,
                      background: sku.lifecycleState === "READY" ? "#dcfce7" : "#f1f5f9",
                      color: sku.lifecycleState === "READY" ? "#166534" : "#334155"
                    }}
                  >
                    {sku.lifecycleState}
                  </span>
                  <div
                    style={{
                      fontFamily: "monospace",
                      fontSize: "0.74rem",
                      color: sku.canonicalSlug ? "#0f172a" : "#94a3b8",
                      marginTop: "0.25rem"
                    }}
                  >
                    {sku.canonicalSlug ?? "slug: NULL [C8]"}
                  </div>
                  {sku.reverificationRequired && sku.lifecycleState !== "ARCHIVED" ? <p>{t("evidence.reverification")}</p> : null}
                  {sku.contentReviewRequired && sku.lifecycleState !== "ARCHIVED" ? <p>{t("content.review_required")}</p> : null}
                </td>
                <td style={{ padding: "0.65rem" }}>{t(`content.${sku.englishContentStatus}`)}</td>

                <td style={{ padding: "0.65rem", fontSize: "0.78rem" }}>
                  {sku.powerKw && (
                    <div>
                      სიმძლავრე: <strong>{sku.powerKw} kW</strong>{" "}
                      {sku.unitSourceStringsJson?.power_kw
                        ? `(${sku.unitSourceStringsJson.power_kw})`
                        : ""}
                    </div>
                  )}
                  {sku.workingWidthMm && (
                    <div>
                      სიგანე: <strong>{sku.workingWidthMm} mm</strong>
                    </div>
                  )}
                  {sku.weightKg && (
                    <div>
                      წონა: <strong>{sku.weightKg} kg</strong>
                    </div>
                  )}
                  {!sku.powerKw && !sku.workingWidthMm && !sku.weightKg && "—"}
                </td>

                <td style={{ padding: "0.65rem", fontSize: "0.76rem" }}>
                  {sku.activeAccountingMappings.length === 0 ? (
                    <span style={{ color: "#b45309", fontWeight: 600 }}>არ არის მიბმული</span>
                  ) : (
                    sku.activeAccountingMappings.map((m) => (
                      <div key={`${m.legalEntityId}-${m.accountingItemId}`}>
                        <strong>{m.legalEntityKey}:</strong>{" "}
                        <code>{m.accountingItemId}</code>
                      </div>
                    ))
                  )}
                </td>

                <td style={{ padding: "0.65rem", fontSize: "0.76rem" }}>
                  {sku.storefrontListings.length === 0 ? (
                    <span style={{ color: "#94a3b8" }}>გამორთულია</span>
                  ) : (
                    sku.storefrontListings.map((l) => (
                      <div key={l.storefrontKey}>
                        {l.storefrontKey}:{" "}
                        <strong style={{ color: l.enabled ? "#15803d" : "#64748b" }}>
                          {l.enabled ? "Listed ✓" : "Off"}
                        </strong>
                      </div>
                    ))
                  )}
                </td>

                <td style={{ padding: "0.65rem" }}>
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <Link
                      href={`/products/${sku.id}`}
                      style={{
                        padding: "0.3rem 0.6rem",
                        borderRadius: "6px",
                        background: "#f1f5f9",
                        color: "#0f172a",
                        textDecoration: "none",
                        fontWeight: 600,
                        fontSize: "0.76rem"
                      }}
                    >
                      დეტალები
                    </Link>
                    <Link
                      href={`/products/${sku.id}/label`}
                      style={{
                        padding: "0.3rem 0.6rem",
                        borderRadius: "6px",
                        background: "#0f172a",
                        color: "#ffffff",
                        textDecoration: "none",
                        fontWeight: 600,
                        fontSize: "0.76rem"
                      }}
                    >
                      58×40მმ ეტიკეტი
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Taxonomy & 30 Product Types Reference */}
      <section
        style={{
          background: "#ffffff",
          border: "1px solid #e2e8f0",
          borderRadius: "12px",
          padding: "1.5rem"
        }}
      >
        <h2 style={{ margin: "0 0 0.75rem 0", fontSize: "1.05rem" }}>
          30 საწყისი Product Type სქემა (§5.8 Product Type Matrix v1)
        </h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
            gap: "0.65rem"
          }}
        >
          {productTypes.map((pt) => (
            <div
              key={pt.id}
              style={{
                padding: "0.65rem 0.8rem",
                borderRadius: "8px",
                border: "1px solid #e2e8f0",
                background: "#f8fafc",
                fontSize: "0.8rem"
              }}
            >
              <div style={{ fontFamily: "monospace", fontWeight: 700, color: "#15803d" }}>
                {pt.key}
              </div>
              <div style={{ fontWeight: 600, marginTop: "0.15rem" }}>
                {pt.nameKa} / {pt.nameEn}
              </div>
              <div style={{ fontSize: "0.72rem", color: "#64748b", marginTop: "0.2rem" }}>
                ატრიბუტები: {pt.attributeSchemaJson.length} · ფოტო სლოტები:{" "}
                {pt.photoInstructionsJson.length}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
