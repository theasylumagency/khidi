import { getDb } from "@khidi/db";
import { formatStaffName, t } from "@khidi/i18n";
import { getPriceHistory } from "@khidi/pricing";
import { formatPrice } from "@khidi/pricing/format";
import { formatTbilisiDateTime } from "@khidi/shared";

export async function PriceHistory({ skuId, userId, storefronts }: { skuId: string; userId: string; storefronts: { id: string; name: string }[] }) {
  const history = await getPriceHistory(getDb(), { userId }, skuId);
  return <section className="pricing"><h2>{t("pricing.history")}</h2>
    {history.length ? <div style={{ overflowX: "auto" }}><table><thead><tr>
      <th>{t("pricing.store")}</th><th>{t("pricing.current")}</th><th>{t("pricing.vat")}</th><th>{t("pricing.changed")}</th><th>{t("pricing.author")}</th><th>{t("pricing.reason")}</th>
    </tr></thead><tbody>{history.map(({ price, authorName }) => <tr key={price.id}>
      <td>{storefronts.find((row) => row.id === price.storefrontId)?.name ?? "—"}</td>
      <td>{price.kind === "SET" ? formatPrice(price.basePriceMinor!) : t("pricing.withdraw")}</td><td>{t(price.vatIncluded ? "pricing.yes" : "pricing.no")}</td>
      <td>{formatTbilisiDateTime(price.setAt)}</td><td>{formatStaffName(authorName)}</td><td>{price.reason === "SKU merged" ? t("pricing.reason_merged") : price.reason === "SKU split" ? t("pricing.reason_split") : price.reason ?? "—"}</td>
    </tr>)}</tbody></table></div> : <p>{t("pricing.empty")}</p>}
  </section>;
}
