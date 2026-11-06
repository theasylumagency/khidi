import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@khidi/db";
import { listLegalEntities, listStorefronts } from "@khidi/entities";
import { getSkuWithDetails, listProductTypes, ALLOWED_LIFECYCLE_TRANSITIONS, type SkuLifecycleState } from "@khidi/products";
import { evidenceFieldOptions, evidenceStrength, listSkuEvidence } from "@khidi/evidence";
import { AppError } from "@khidi/shared";
import { requirePageAuth } from "../../../lib/session.ts";
import { SkuDetailActions } from "../../../components/sku-detail-actions.tsx";
import { PhotoRequestForm } from "../../../components/photo-request-form.tsx";
import { listTaskAssignees } from "@khidi/scanning";
import { formatStaffName, t, type TranslationKey } from "@khidi/i18n";
import { listMediaImageViews } from "@khidi/media";
import { AdminMediaPanel } from "../../../components/admin-media-panel.tsx";
import { EvidenceCapture } from "../../../components/evidence-capture.tsx";
import { EvidenceReview } from "../../../components/evidence-review.tsx";
import { EvidenceRequestForm } from "../../../components/evidence-request-form.tsx";
import { AiJobAction } from "../../../components/ai-job-action.tsx";

export const dynamic = "force-dynamic";

export default async function SkuDetailPage({
  params
}: {
  params: Promise<{ skuId: string }>;
}) {
  const principal = await requirePageAuth({
    allowedRoles: ["ADMIN", "OPERATOR", "STOCK_MANAGER"]
  });

  const { skuId } = await params;
  const db = getDb();
  const photoAssignees = principal.role === "ADMIN" ? (await listTaskAssignees(db, principal)).filter((user) => user.role === "WAREHOUSE").map((user) => ({ id: user.id, fullName: formatStaffName(user.fullName) })) : [];

  let details: Awaited<ReturnType<typeof getSkuWithDetails>>;
  try {
    details = await getSkuWithDetails(db, skuId);
  } catch (err) {
    if (err instanceof AppError && err.code === "NOT_FOUND") {
      notFound();
    }
    throw err;
  }

  const [entities, allStorefronts] = await Promise.all([
    listLegalEntities(db),
    listStorefronts(db)
  ]);

  const {
    sku,
    category,
    productType,
    family,
    identifiers,
    accountingMappings,
    storefrontListings,
    slugHistory,
    bundleComponents,
    labelSpec
  } = details;

  const storefrontOptions = allStorefronts.map((sf) => {
    const found = storefrontListings.find((l) => l.storefrontId === sf.id);
    return {
      id: sf.id,
      key: sf.key,
      name: sf.name,
      enabled: Boolean(found?.enabled)
    };
  });
  const images = principal.role === "ADMIN" ? await listMediaImageViews(db, principal, { skuId }) : [];
  const evidenceView = principal.role === "ADMIN" ? await listSkuEvidence(db, { userId: principal.userId }, skuId) : null;
  const typeOptions = evidenceView ? (await listProductTypes(db)).filter((type) => type.active).map((type) => ({ id: type.id, nameKa: type.nameKa })) : [];

  return (
    <div style={{ display: "grid", gap: "1.5rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Link href="/products" style={{ color: "#15803d", fontWeight: 600, fontSize: "0.9rem" }}>
          ← პროდუქტების ცხრილზე დაბრუნება
        </Link>
        <Link
          href={`/products/${sku.id}/label`}
          style={{
            padding: "0.5rem 1rem",
            background: "#0f172a",
            color: "#ffffff",
            borderRadius: "8px",
            textDecoration: "none",
            fontWeight: 700,
            fontSize: "0.85rem"
          }}
        >
          🖨 58×40 მმ თერმული ეტიკეტის ბეჭდვა (§5.4)
        </Link>
      </div>

      {/* Main Identity Card */}
      <section
        style={{
          background: "#ffffff",
          border: "1px solid #e2e8f0",
          borderRadius: "12px",
          padding: "1.5rem",
          display: "grid",
          gridTemplateColumns: "1fr auto",
          gap: "1.5rem",
          alignItems: "start"
        }}
      >
        <div>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
            <span
              style={{
                fontFamily: "monospace",
                fontWeight: 800,
                fontSize: "1.05rem",
                background: "#f1f5f9",
                padding: "0.2rem 0.6rem",
                borderRadius: "6px"
              }}
            >
              {sku.internalSku}
            </span>
            <span
              style={{
                padding: "0.2rem 0.6rem",
                borderRadius: "999px",
                fontSize: "0.78rem",
                fontWeight: 700,
                background: sku.lifecycleState === "READY" ? "#dcfce7" : "#fef3c7",
                color: sku.lifecycleState === "READY" ? "#166534" : "#92400e"
              }}
            >
              {sku.lifecycleState}
            </span>
            <span
              style={{
                padding: "0.2rem 0.6rem",
                borderRadius: "999px",
                fontSize: "0.78rem",
                fontWeight: 700,
                background: "#e0f2fe",
                color: "#0369a1"
              }}
            >
              Confidence: {sku.identityConfidence}
            </span>
          </div>

          <h1 style={{ margin: "0.6rem 0 0.25rem 0", fontSize: "1.45rem" }}>
            {sku.displayNameKa ?? sku.modelCode ?? sku.internalSku}
          </h1>
          {sku.displayNameEn && (
            <div style={{ color: "#475569", fontSize: "0.95rem" }}>{sku.displayNameEn}</div>
          )}

          <div
            style={{
              marginTop: "0.85rem",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: "0.65rem",
              fontSize: "0.85rem"
            }}
          >
            <div>
              <strong>კატეგორია (§5.7):</strong> {category?.nameKa ?? "—"}
            </div>
            <div>
              <strong>პროდუქტის ტიპი (§5.8):</strong> {productType?.nameKa ?? "—"} (
              <code>{productType?.key ?? "NONE"}</code>)
            </div>
            <div>
              <strong>ოჯახი (§5.1):</strong> {family ? `${family.code} — ${family.titleKa}` : "—"}
            </div>
            <div>
              <strong>Canonical Slug ([C8]):</strong>{" "}
              <code>{sku.canonicalSlug ?? "NULL (pre-READY)"}</code>
            </div>
          </div>

          {sku.searchAliasesKa.length > 0 && (
            <div style={{ marginTop: "0.65rem", fontSize: "0.8rem", color: "#475569" }}>
              <strong>საძიებო სინონიმები (KA, §5.10):</strong> {sku.searchAliasesKa.join(", ")}
            </div>
          )}
        </div>

        {/* Inline 58x40mm Thermal Label Preview */}
        <div
          style={{
            border: "1px dashed #94a3b8",
            borderRadius: "8px",
            padding: "0.75rem",
            background: "#f8fafc",
            width: "240px"
          }}
        >
          <div style={{ fontSize: "0.72rem", color: "#64748b", marginBottom: "0.4rem" }}>
            თერმული ეტიკეტი ({labelSpec.widthMm}×{labelSpec.heightMm} მმ, §5.4)
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
            <div>
              <div style={{ fontFamily: "monospace", fontWeight: 800, fontSize: "0.95rem" }}>
                {sku.internalSku}
              </div>
              <div style={{ fontSize: "0.72rem", marginTop: "0.2rem" }}>
                {sku.displayNameKa ?? sku.modelCode}
              </div>
            </div>
            <div
              style={{ width: "56px", height: "56px", flexShrink: 0 }}
              dangerouslySetInnerHTML={{ __html: labelSpec.qrSvg }}
            />
          </div>
          <div
            style={{ marginTop: "0.5rem", height: "36px" }}
            dangerouslySetInnerHTML={{ __html: labelSpec.code128Svg }}
          />
        </div>
      </section>

      {/* Admin Controls ([C7, C8, C9], §4.5) */}
      {principal.role === "ADMIN" && (
        <section
          style={{
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: "12px",
            padding: "1.5rem"
          }}
        >
          <h2 style={{ margin: "0 0 1rem 0", fontSize: "1.1rem" }}>
            ადმინისტრატორის მართვის პანელი ([C7, C8, C9], §4.5)
          </h2>
          <SkuDetailActions
            skuId={sku.id}
            lifecycleState={sku.lifecycleState}
            identityConfidence={sku.identityConfidence}
            identityKind={sku.identityKind}
            nextStates={(ALLOWED_LIFECYCLE_TRANSITIONS[sku.lifecycleState as SkuLifecycleState] ?? []).filter((state) => state !== "READY")}
            canonicalSlug={sku.canonicalSlug}
            entities={entities}
            storefronts={storefrontOptions}
          />
        </section>
      )}
      {evidenceView ? <section className="office-login">
        <h2>{t("evidence.items")}</h2>
        {sku.reverificationRequired ? <p role="status">{t("evidence.reverification")}</p> : null}
        {evidenceView.comparisons.length ? <p>{t("evidence.duplicate_warning")} {evidenceView.comparisons.map((item) => item.internalSku).join(", ")}</p> : null}
        <EvidenceCapture skuId={sku.id} fields={evidenceFieldOptions(productType)} comparisons={evidenceView.comparisons}
          images={images.map((image) => ({ id: image.id, label: `${t(`media.slot.${image.slot}` as TranslationKey)} · ${image.sortOrder + 1}` }))} />
        <EvidenceReview skuId={sku.id} kind={sku.identityKind} productTypes={typeOptions} productTypeId={sku.productTypeId}
          editableType={!["READY", "ARCHIVED"].includes(sku.lifecycleState)} fields={evidenceView.fields}
          fieldOptions={evidenceFieldOptions(productType)}
          distinguishing={productType?.distinguishingAttributes ?? []}
          photoUrls={Object.fromEntries(images.map((image) => [image.id, image.previewUrl]))}
          items={evidenceView.items.map((item) => ({ ...item, strength: evidenceStrength(item), attachment: !!item.privateStorageKey,
            privateStorageKey: undefined, privateSha256: undefined }))} />
        <EvidenceRequestForm skuId={sku.id} assignees={photoAssignees} />
        <AiJobAction skuId={sku.id} />
        <Link href="/evidence/jobs">{t("evidence.ai_jobs")}</Link>
        <Link href="/evidence/missing">{t("evidence.missing")}</Link>
      </section> : null}

      {/* Universal Units & Type Attributes */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
          gap: "1.25rem"
        }}
      >
        <section
          style={{
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: "12px",
            padding: "1.25rem"
          }}
        >
          <h2 style={{ margin: "0 0 0.75rem 0", fontSize: "1.05rem" }}>
            ნორმალიზებული ერთეულები (§5.6)
          </h2>
          <div style={{ display: "grid", gap: "0.45rem", fontSize: "0.85rem" }}>
            <div>
              სიმძლავრე (`power_kw`): <strong>{sku.powerKw ?? "—"} kW</strong>{" "}
              {sku.unitSourceStringsJson?.power_kw
                ? `(წყარო: "${sku.unitSourceStringsJson.power_kw}")`
                : ""}
            </div>
            <div>
              ძრავის მოცულობა (`engine_displacement_cm3`):{" "}
              <strong>{sku.engineDisplacementCm3 ?? "—"} cm³</strong>
            </div>
            <div>
              სამუშაო სიგანე (`working_width_mm`):{" "}
              <strong>{sku.workingWidthMm ?? "—"} mm</strong>
            </div>
            <div>
              სამუშაო სიღრმე (`working_depth_mm`):{" "}
              <strong>{sku.workingDepthMm ?? "—"} mm</strong>
            </div>
            <div>
              წონა (`weight_kg`): <strong>{sku.weightKg ?? "—"} kg</strong>
            </div>
          </div>
        </section>

        <section
          style={{
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: "12px",
            padding: "1.25rem"
          }}
        >
          <h2 style={{ margin: "0 0 0.75rem 0", fontSize: "1.05rem" }}>
            პროდუქტის ტიპის ატრიბუტები (`type_attributes_json`, §5.9)
          </h2>
          {Object.keys(sku.typeAttributesJson).length === 0 ? (
            <div style={{ color: "#64748b", fontSize: "0.85rem" }}>ატრიბუტები ჯერ არ არის შევსებული.</div>
          ) : (
            <div style={{ display: "grid", gap: "0.45rem", fontSize: "0.85rem" }}>
              {Object.entries(sku.typeAttributesJson).map(([k, entry]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between" }}>
                  <code>{k}</code>
                  <span>
                    <strong>{String(entry.value ?? "NULL")}</strong>{" "}
                    <span
                      style={{
                        fontSize: "0.72rem",
                        padding: "0.1rem 0.4rem",
                        borderRadius: "4px",
                        background: entry.status === "VERIFIED" ? "#dcfce7" : "#f1f5f9",
                        color: entry.status === "VERIFIED" ? "#166534" : "#475569"
                      }}
                    >
                      {entry.status}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Composed Bundle or Factory Kit Details (§5.2) */}
      {(sku.isComposedBundle || sku.isKit) && (
        <section
          style={{
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: "12px",
            padding: "1.25rem"
          }}
        >
          <h2 style={{ margin: "0 0 0.75rem 0", fontSize: "1.05rem" }}>
            {sku.isComposedBundle
              ? "კომპოზიტური ბანდლის კომპონენტები (`bundle_components`, §5.2)"
              : "ქარხნული კომპლექტის შემადგენლობა (`kit_components_json`, §5.2)"}
          </h2>
          {sku.isComposedBundle ? (
            <ul style={{ margin: 0, paddingLeft: "1.2rem", fontSize: "0.85rem" }}>
              {bundleComponents.map((comp) => (
                <li key={comp.componentSkuId}>
                  <Link href={`/products/${comp.componentSkuId}`} style={{ color: "#15803d" }}>
                    <code>{comp.componentInternalSku}</code>
                  </Link>{" "}
                  — {comp.componentDisplayNameKa} × <strong>{comp.quantity}</strong>
                </li>
              ))}
            </ul>
          ) : (
            <ul style={{ margin: 0, paddingLeft: "1.2rem", fontSize: "0.85rem" }}>
              {(sku.kitComponentsJson ?? []).map((item, idx) => (
                <li key={idx}>
                  {item.nameKa} × <strong>{item.quantity}</strong>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Accounting Mappings ([C9], §5.5) & Identifiers (§5.3) & Slug History ([C7, C8]) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
          gap: "1.25rem"
        }}
      >
        <section
          style={{
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: "12px",
            padding: "1.25rem"
          }}
        >
          <h2 style={{ margin: "0 0 0.75rem 0", fontSize: "1.05rem" }}>
            ბუღალტრული მეპინგი იურიდიული პირების მიხედვით ([C9], §5.5)
          </h2>
          {accountingMappings.length === 0 ? (
            <div style={{ color: "#64748b", fontSize: "0.85rem" }}>
              მეპინგი ჯერ არ არის დამატებული.
            </div>
          ) : (
            <div style={{ display: "grid", gap: "0.5rem", fontSize: "0.84rem" }}>
              {accountingMappings.map((m) => (
                <div
                  key={m.id}
                  style={{
                    padding: "0.6rem",
                    borderRadius: "8px",
                    background: m.active ? "#f0fdf4" : "#f8fafc",
                    border: "1px solid #cbd5e1"
                  }}
                >
                  <div>
                    <strong>{m.legalEntityKey}</strong> ({m.legalEntityName}) ·{" "}
                    <code>{m.accountingItemId}</code>{" "}
                    <span style={{ fontSize: "0.74rem", fontWeight: 700 }}>
                      [{m.active ? "ACTIVE" : "INACTIVE"}]
                    </span>
                  </div>
                  <div style={{ marginTop: "0.2rem" }}>{m.accountingName}</div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section
          style={{
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: "12px",
            padding: "1.25rem"
          }}
        >
          <h2 style={{ margin: "0 0 0.75rem 0", fontSize: "1.05rem" }}>
            იდენტიფიკატორები და სლაგების ისტორია (§5.3, [C7, C8])
          </h2>
          <div style={{ display: "grid", gap: "0.4rem", fontSize: "0.83rem" }}>
            {identifiers.map((idRow) => (
              <div key={idRow.id} style={{ display: "flex", justifyContent: "space-between" }}>
                <span>
                  <strong>{idRow.identifierType}:</strong> <code>{idRow.value}</code>
                </span>
                <span style={{ color: idRow.hasCollision ? "#b91c1c" : "#15803d", fontWeight: 700 }}>
                  {idRow.hasCollision ? "⚠ COLLISION" : "OK"}
                </span>
              </div>
            ))}
          </div>

          <h3 style={{ margin: "1rem 0 0.4rem 0", fontSize: "0.9rem" }}>
            Append-Only `sku_slug_history` ([C7, C8]):
          </h3>
          {slugHistory.length === 0 ? (
            <div style={{ fontSize: "0.8rem", color: "#64748b" }}>
              სლაგი ჯერ არ შეცვლილა.
            </div>
          ) : (
            <ul style={{ margin: 0, paddingLeft: "1.2rem", fontSize: "0.82rem" }}>
              {slugHistory.map((h) => (
                <li key={h.id}>
                  <code>{h.oldSlug}</code> (შეიცვალა: {new Date(h.changedAt).toISOString()})
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      {principal.role === "ADMIN" ? (
        <>
          <AdminMediaPanel skuId={skuId} images={images} assignees={photoAssignees} />
          <section><PhotoRequestForm skuId={skuId} assignees={photoAssignees} /></section>
        </>
      ) : null}
    </div>
  );
}
