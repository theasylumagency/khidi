import { redirect } from "next/navigation";
import { canEditPrices, canViewPrices } from "@khidi/auth";
import { getDb } from "@khidi/db";
import { listStorefronts } from "@khidi/entities";
import { formatStaffName, t, type TranslationKey } from "@khidi/i18n";
import { assertPriceAccess, listLatestPrices } from "@khidi/pricing";
import { listProductTypes, listSkusWorkspace } from "@khidi/products";
import { getSkuPublicationReview } from "@khidi/publishing";
import { requirePageAuth } from "../../lib/session.ts";
import { PriceWorkspace } from "../../components/price-workspace.tsx";

export const dynamic = "force-dynamic";
export default async function PricesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const principal = await requirePageAuth();
  if (!canViewPrices(principal)) redirect("/?forbidden=1");
  const db = getDb();
  await assertPriceAccess(db, { userId: principal.userId });
  const [stores, products, types, staff, query, entities] = await Promise.all([
    listStorefronts(db), listSkusWorkspace(db), listProductTypes(db), db.query.users.findMany(), searchParams, db.query.legalEntities.findMany()
  ]);
  const store = stores.find((row) => row.id === query.storefrontId) ?? stores[0];
  if (!store) return <p>{t("pricing.empty")}</p>;
  const latest = await listLatestPrices(db, { storefrontId: store.id });
  const bySku = new Map(latest.map((row) => [row.skuId, row]));
  const byStaff = new Map(staff.map((row) => [row.id, formatStaffName(row.fullName)]));
  const typeById = new Map(types.map((row) => [row.id, row]));
  let visible = products.filter((row) => (!query.type || row.productTypeKey === query.type) && (!query.lifecycle || row.lifecycleState === query.lifecycle)
    && (!query.missing || bySku.get(row.id)?.kind !== "SET"));
  if (query.missing === "publish-ready") {
    const checks = await Promise.all(visible.map(async (row) => ({ id: row.id, review: await getSkuPublicationReview(db, row.id) })));
    const ready = new Set(checks.filter(({ review }) => review.some((row) => row.storefrontId === store.id && row.locale === "ka" && row.publishReady)).map(({ id }) => id));
    visible = visible.filter((row) => ready.has(row.id));
  }
  const storeOptions = stores.map((row, index) => ({ id: row.id, label: `${t("pricing.store")} ${index + 1}` }));
  return <section className="pricing">
    <h1>{t("pricing.title")}</h1>
    <form action="/prices">
      <label>{t("pricing.store")} <select name="storefrontId" defaultValue={store.id}>{storeOptions.map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}</select></label>
      <label>{t("pricing.type")} <select name="type" defaultValue={typeof query.type === "string" ? query.type : ""}><option value="">{t("pricing.all")}</option>{[...typeById.values()].map((row) => <option key={row.id} value={row.key}>{row.nameKa}</option>)}</select></label>
      <label>{t("pricing.lifecycle")} <select name="lifecycle" defaultValue={typeof query.lifecycle === "string" ? query.lifecycle : ""}><option value="">{t("pricing.all")}</option>{[...new Set(products.map((row) => row.lifecycleState))].map((state) => <option key={state} value={state}>{t(`pricing.state.${state}` as TranslationKey)}</option>)}</select></label>
      <select aria-label={t("pricing.no_price")} name="missing" defaultValue={typeof query.missing === "string" ? query.missing : ""}><option value="">{t("pricing.all")}</option><option value="no-price">{t("pricing.no_price")}</option><option value="publish-ready">{t("pricing.publish_ready")}</option></select>
      <button>{t("pricing.filter")}</button>
    </form>
    <PriceWorkspace key={store.id + JSON.stringify(query)} storefrontId={store.id} stores={storeOptions} canEdit={canEditPrices(principal)} admin={principal.role === "ADMIN"}
      defaultVat={entities.find((row) => row.id === store.sellerEntityId)?.pricesIncludeVat ?? false}
      rows={visible.map((row) => { const price = bySku.get(row.id); return {
        skuId: row.id, code: row.internalSku, name: row.displayNameKa ?? row.internalSku,
        amount: price?.kind === "SET" ? price.basePriceMinor : null, expectedPriceId: price?.id ?? null,
        vatIncluded: price?.vatIncluded ?? null, setAt: price?.setAt.toISOString() ?? null, author: price ? byStaff.get(price.setBy) ?? "" : ""
      }; })} />
  </section>;
}
