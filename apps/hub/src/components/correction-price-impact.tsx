import { t } from "@khidi/i18n";
import { formatPrice } from "@khidi/pricing/format";
import type { CorrectionPriceImpact } from "@khidi/pricing";

export function CorrectionPriceImpactPanel({ impact, targets }: {
  impact: CorrectionPriceImpact; targets: { id?: string; label: string }[];
}) {
  if (!impact.sourcePrices.length) return null;
  return <section aria-label={t("correction.prices_withdrawn")}>
    <h3>{t("correction.prices_withdrawn")}</h3><p>{t("correction.prices_not_copied")}</p>
    <ul>{impact.sourcePrices.map((price) => <li key={price.storefrontId}>{price.storefrontName}: {formatPrice(price.amount)} · {t("pricing.vat")}: {t(price.vatIncluded ? "pricing.yes" : "pricing.no")}</li>)}</ul>
    {targets.flatMap((target, index) => impact.sourcePrices.filter((price) => !target.id || !impact.pricedStorefrontsBySku[target.id]?.includes(price.storefrontId))
      .map((price) => <p role="alert" key={index + ":" + price.storefrontId}>{target.label} · {price.storefrontName}: {t("correction.target_no_price")} {t("correction.old_price_info")}: {formatPrice(price.amount)}</p>))}
  </section>;
}
