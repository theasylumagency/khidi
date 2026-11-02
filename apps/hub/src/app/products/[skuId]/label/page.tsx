import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@khidi/db";
import { getSkuWithDetails } from "@khidi/products";
import { AppError } from "@khidi/shared";
import { requirePageAuth } from "../../../../lib/session.ts";
import { PrintLabelButton } from "../../../../components/print-label-button.tsx";

export const dynamic = "force-dynamic";

export default async function SkuThermalLabelPage({
  params
}: {
  params: Promise<{ skuId: string }>;
}) {
  await requirePageAuth();
  const { skuId } = await params;
  const db = getDb();

  let details: Awaited<ReturnType<typeof getSkuWithDetails>>;
  try {
    details = await getSkuWithDetails(db, skuId);
  } catch (err) {
    if (err instanceof AppError && err.code === "NOT_FOUND") {
      notFound();
    }
    throw err;
  }

  const { sku, labelSpec } = details;

  return (
    <div style={{ display: "grid", gap: "1.25rem", maxWidth: "540px", margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Link href={`/products/${sku.id}`} style={{ color: "#15803d", fontWeight: 600 }}>
          ← SKU დეტალებზე დაბრუნება
        </Link>
        <PrintLabelButton />
      </div>

      <section
        style={{
          background: "#ffffff",
          border: "1px solid #cbd5e1",
          borderRadius: "12px",
          padding: "1.5rem",
          display: "grid",
          gap: "1rem",
          justifyItems: "center"
        }}
      >
        <div style={{ fontSize: "0.85rem", color: "#475569", textAlign: "center" }}>
          თერმული პრინტერის ეტიკეტის ზუსტი ზომა:{" "}
          <strong>
            {labelSpec.widthMm} × {labelSpec.heightMm} მმ
          </strong>{" "}
          (QR + Code128, §5.4)
        </div>

        {/* 58mm x 40mm Label Box */}
        <div
          style={{
            width: "58mm",
            height: "40mm",
            padding: "2mm 2.5mm",
            border: "2px dashed #0f172a",
            background: "#ffffff",
            color: "#000000",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            overflow: "hidden"
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: "2mm" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontFamily: "monospace",
                  fontSize: "11pt",
                  fontWeight: 800,
                  lineHeight: 1.1
                }}
              >
                {sku.internalSku}
              </div>
              <div
                style={{
                  fontSize: "7.5pt",
                  fontWeight: 600,
                  lineHeight: 1.15,
                  marginTop: "1mm"
                }}
              >
                {sku.displayNameKa ?? sku.modelCode ?? sku.internalSku}
              </div>
            </div>
            <div
              style={{ width: "15mm", height: "15mm", flexShrink: 0 }}
              dangerouslySetInnerHTML={{ __html: labelSpec.qrSvg }}
            />
          </div>
          <div
            style={{ width: "100%", height: "11mm" }}
            dangerouslySetInnerHTML={{ __html: labelSpec.code128Svg }}
          />
        </div>

        <div style={{ fontSize: "0.78rem", color: "#64748b", fontFamily: "monospace" }}>
          QR Payload: {labelSpec.qrValue}
        </div>
      </section>
    </div>
  );
}
