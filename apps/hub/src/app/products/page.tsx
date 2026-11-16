import { CatalogTable } from "../../components/catalog-table.tsx";
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
    <div className="hub-stack">
      <header className="hub-page-toolbar">
        <h1>{t("content.catalog")}</h1>
        {principal.role === "ADMIN" ? <Link className="hub-control-link" href="/products/configuration">{t("setup.subtypes")}</Link> : null}
      </header>
      <dl className="hub-summary">
        <div><dt>{t("ui.catalog.skus")}</dt><dd>{skus.length}</dd></div>
        <div><dt>{t("ui.catalog.categories")}</dt><dd>{categories.filter((category) => !category.isUnclassified).length}</dd></div>
        <div><dt>{t("ui.catalog.types")}</dt><dd>{productTypes.length}</dd></div>
        <div><dt>{t("ui.catalog.legacy")}</dt><dd>{legacyUrls.length}</dd></div>
      </dl>
      {canCreateSku ? (
        <details className="hub-panel">
          <summary>{t("ui.catalog.create")}</summary>
          <ProductCreateForm productTypes={productTypes} />
        </details>
      ) : null}
      <section className="hub-panel hub-stack">
        <h2>{t("content.catalog_table")}</h2>
        <form action="/products" className="hub-form-row">
          <label>{t("content.search")} <input type="search" name="q" defaultValue={search} placeholder={t("ui.search_placeholder")} /></label>
          <label><input type="checkbox" name="english" value="ready-without-approval" defaultChecked={readyWithoutEnglish} /> {t("content.ready_without_en")}</label>
          <button type="submit">{t("content.apply_filters")}</button>
        </form>
        {visibleSkus.length === 0 ? <p className="hub-empty">{t("content.no_matches")}</p> : null}

        <CatalogTable skus={visibleSkus} />
      </section>

      <details className="hub-panel">
        <summary>{t("ui.catalog.types")}</summary>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 240px), 1fr))",
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
                {t("ui.attributes")}: {pt.attributeSchemaJson.length} · {t("ui.photo_slots")}:{" "}
                {pt.photoInstructionsJson.length}
              </div>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
