import Link from "next/link";
import { t, type TranslationKey } from "@khidi/i18n";
import type { listSkusWorkspace } from "@khidi/products";
import { HubIcon } from "./hub-icon.tsx";
import { TableScroll } from "./table-scroll.tsx";

export function CatalogTable({ skus }: { skus: Awaited<ReturnType<typeof listSkusWorkspace>> }) {
  return <TableScroll label={t("content.catalog_table")}><table className="hub-catalog-table">
    <thead><tr>{["sku", "product", "classification", "status", "english", "units", "accounting", "storefronts", "label"].map(key =>
      <th scope="col" key={key}>{t((key === "english" ? "content.english_status" : key === "storefronts" ? "ui.storefronts" : `ui.catalog.${key}`) as TranslationKey)}</th>
    )}</tr></thead>
    <tbody>{skus.map(sku => <tr key={sku.id}>
      <td><Link href={`/products/${sku.id}`} className="hub-sku-code">{sku.internalSku}</Link>
        <div className="hub-catalog-flags">
          {sku.isComposedBundle ? <span>{t("ui.catalog_bundle")}</span> : null}
          {sku.isKit ? <span>{t("ui.catalog_kit")}</span> : null}
          {sku.hasIdentifierCollision ? <span className="hub-catalog-warning">{t("ui.catalog_collision")}</span> : null}
        </div>
      </td>
      <td><div className="hub-catalog-identity"><span className="hub-catalog-symbol"><HubIcon name="products" /></span>
        <div><Link href={`/products/${sku.id}`} className="hub-product-name">{sku.displayNameKa ?? sku.modelCode ?? t("ui.unnamed_product")}</Link>
          {sku.displayNameEn ? <small>{sku.displayNameEn}</small> : null}</div></div></td>
      <td><strong>{sku.productTypeNameKa}</strong><small>{sku.categoryNameKa}</small></td>
      <td><span className="hub-status" data-state={sku.lifecycleState}>{t(`ui.state.${sku.lifecycleState}` as TranslationKey)}</span>
        <small className="hub-slug">{sku.canonicalSlug ?? t("ui.no_slug")}</small>
        {sku.reverificationRequired && sku.lifecycleState !== "ARCHIVED" ? <p className="hub-catalog-warning">{t("evidence.reverification")}</p> : null}
        {sku.contentReviewRequired && sku.lifecycleState !== "ARCHIVED" ? <p className="hub-catalog-warning">{t("content.review_required")}</p> : null}
      </td>
      <td>{t(`content.${sku.englishContentStatus}`)}</td>
      <td>
        {sku.powerKw ? <div>{t("ui.power")}: <strong>{sku.powerKw} kW</strong>{sku.unitSourceStringsJson?.power_kw ? ` (${sku.unitSourceStringsJson.power_kw})` : ""}</div> : null}
        {sku.workingWidthMm ? <div>{t("ui.width")}: <strong>{sku.workingWidthMm} mm</strong></div> : null}
        {sku.weightKg ? <div>{t("ui.weight")}: <strong>{sku.weightKg} kg</strong></div> : null}
        {!sku.powerKw && !sku.workingWidthMm && !sku.weightKg ? "—" : null}
      </td>
      <td>{sku.activeAccountingMappings.length ? sku.activeAccountingMappings.map(m => <div key={`${m.legalEntityId}-${m.accountingItemId}`}><strong>{m.legalEntityKey}:</strong> <code>{m.accountingItemId}</code></div>) : <span className="hub-catalog-warning">{t("ui.unmapped")}</span>}</td>
      <td>{sku.storefrontListings.length ? sku.storefrontListings.map(l => <div key={l.storefrontKey}>{l.storefrontKey}: <strong>{t(l.enabled ? "ui.listed" : "ui.unlisted")}</strong></div>) : <span>{t("ui.unlisted")}</span>}</td>
      <td><div className="hub-row-actions"><Link href={`/products/${sku.id}`}>{t("ui.open")}</Link><Link href={`/products/${sku.id}/label`}>{t("ui.print_label")}</Link></div></td>
    </tr>)}</tbody>
  </table></TableScroll>;
}
