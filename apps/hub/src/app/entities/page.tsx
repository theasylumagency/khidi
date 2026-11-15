import { TableScroll } from "../../components/table-scroll.tsx";
import Link from "next/link";
import { getDb } from "@khidi/db";
import { listLegalEntities, listEntityRelationships } from "@khidi/entities";
import { t } from "@khidi/i18n";
import { formatTbilisiDateTime } from "@khidi/shared";
import { isSharedWarehouseBrowser, requirePageAuth } from "../../lib/session.ts";
import { EntityCreateForm } from "../../components/entity-create-form.tsx";

export const dynamic = "force-dynamic";

export default async function EntitiesPage() {
  await requirePageAuth({ allowedRoles: ["ADMIN"] });
  const db = getDb();
  const [entities, relationships, sharedDevice] = await Promise.all([
    listLegalEntities(db),
    listEntityRelationships(db),
    isSharedWarehouseBrowser()
  ]);
  const names = new Map(entities.map((entity) => [entity.id, entity.legalName]));

  return (
    <div className="hub-stack">
      <h1>{t("ui.entities")}</h1>
      <EntityCreateForm sharedDevice={sharedDevice} />
      <nav className="hub-panel hub-setup-links" aria-label={t("setup.next_steps")}>
        <h2>{t("setup.next_steps")}</h2>
        <ol>
          <li><Link href="/storefronts">{t("setup.stores")}</Link></li>
          <li><Link href="/inventory">{t("setup.pools_relationships")}</Link></li>
          <li><Link href="/users">{t("users.title")}</Link></li>
          <li><Link href="/products/configuration">{t("setup.subtypes")}</Link></li>
        </ol>
      </nav>

      <TableScroll>
        <table>
          <thead>
            <tr>
              <th>{t("setup.key")}</th>
              <th>{t("setup.legal_name")}</th>
              <th>{t("setup.tax_id")}</th>
              <th>{t("setup.vat")}</th>
              <th>{t("users.status")}</th>
            </tr>
          </thead>
          <tbody>
            {entities.map((entity) => (
              <tr key={entity.id}>
                <td>{entity.key}</td>
                <td>{entity.legalName}</td>
                <td>{entity.taxId}</td>
                <td>{t(entity.pricesIncludeVat ? "setup.yes" : "setup.no")}</td>
                <td>{t(entity.active ? "users.active" : "users.inactive")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>

      <section className="hub-panel">
        <h2>{t("inventory.relationship")}</h2>
        <p>{t("setup.relationship_help")}</p>
        <TableScroll>
          <table>
            <thead>
              <tr>
                <th>{t("inventory.from_entity")}</th>
                <th>{t("inventory.to_entity")}</th>
                <th>{t("inventory.mode")}</th>
                <th>{t("setup.effective")}</th>
                <th>{t("evidence.notes")}</th>
              </tr>
            </thead>
            <tbody>
              {relationships.map((row) => (
                <tr key={row.id}>
                  <td>{names.get(row.fromEntityId) ?? row.fromEntityId}</td>
                  <td>{names.get(row.toEntityId) ?? row.toEntityId}</td>
                  <td>{t(row.mode === "CONSIGNMENT" ? "inventory.mode.CONSIGNMENT" : "inventory.mode.PURCHASE")}</td>
                  <td>{formatTbilisiDateTime(row.effectiveFrom)}</td>
                  <td>{row.notes ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </section>
    </div>
  );
}
