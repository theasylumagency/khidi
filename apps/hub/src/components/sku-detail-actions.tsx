"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface LegalEntityOption {
  id: string;
  key: string;
  legalName: string;
}

interface StorefrontOption {
  id: string;
  key: string;
  name: string;
  enabled: boolean;
}

export function SkuDetailActions({
  skuId,
  lifecycleState,
  identityConfidence,
  canonicalSlug,
  entities,
  storefronts
}: {
  skuId: string;
  lifecycleState: string;
  identityConfidence: string;
  canonicalSlug: string | null;
  entities: LegalEntityOption[];
  storefronts: StorefrontOption[];
}) {
  const router = useRouter();
  const [legalEntityId, setLegalEntityId] = useState(entities[0]?.id ?? "");
  const [accountingItemId, setAccountingItemId] = useState("");
  const [accountingName, setAccountingName] = useState("");
  const [legacyCode, setLegacyCode] = useState("");
  const [slugInput, setSlugInput] = useState(canonicalSlug ?? "");
  const [confidenceLevel, setConfidenceLevel] = useState(identityConfidence);
  const [confidenceReason, setConfidenceReason] = useState("");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSetConfidenceManually = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!confidenceReason.trim()) {
      setErrorMsg("Confidence-ის ხელით დადგენისთვის მიზეზი სავალდებულოა");
      return;
    }
    setLoading(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await fetch("/api/products/confidence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skuId,
          level: confidenceLevel,
          reason: confidenceReason.trim()
        })
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setErrorMsg(data.error ?? "Confidence-ის განახლება ვერ მოხერხდა");
      } else {
        setConfidenceReason("");
        setStatusMsg(
          `✓ იდენტობის სანდოობა ხელით განისაზღვრა: ${confidenceLevel} (ჩაიწერა audit_logs-ში: IDENTITY_CONFIDENCE_SET_MANUALLY)`
        );
        router.refresh();
      }
    } catch {
      setErrorMsg("ქსელური შეცდომა");
    } finally {
      setLoading(false);
    }
  };

  const handleAddMapping = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await fetch("/api/products/accounting-mappings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skuId,
          legalEntityId,
          accountingItemId,
          accountingName,
          legacyCode
        })
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setErrorMsg(data.error ?? "ბუღალტრული მეპინგის შენახვა ვერ მოხერხდა");
      } else {
        setAccountingItemId("");
        setAccountingName("");
        setLegacyCode("");
        setStatusMsg("✓ ბუღალტრული მეპინგი შენახულია [C9]");
        router.refresh();
      }
    } catch {
      setErrorMsg("ქსელური შეცდომა");
    } finally {
      setLoading(false);
    }
  };

  const handleTransitionReady = async () => {
    setLoading(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await fetch("/api/products/ready", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skuId,
          action: "TRANSITION_READY"
        })
      });
      const data = (await res.json()) as { error?: string; sku?: { canonicalSlug: string } };
      if (!res.ok) {
        setErrorMsg(data.error ?? "READY სტატუსზე გადაყვანა ვერ მოხერხდა");
      } else {
        setSlugInput(data.sku?.canonicalSlug ?? "");
        setStatusMsg(`✓ SKU გადავიდა READY სტატუსში, მიენიჭა სლაგი: ${data.sku?.canonicalSlug} [C8]`);
        router.refresh();
      }
    } catch {
      setErrorMsg("ქსელური შეცდომა");
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateSlug = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!slugInput.trim()) return;
    setLoading(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await fetch("/api/products/ready", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skuId,
          action: "UPDATE_SLUG",
          customCanonicalSlug: slugInput.trim(),
          reason: "Admin canonical slug update"
        })
      });
      const data = (await res.json()) as { error?: string; sku?: { canonicalSlug: string } };
      if (!res.ok) {
        setErrorMsg(data.error ?? "სლაგის განახლება ვერ მოხერხდა");
      } else {
        setStatusMsg(
          `✓ სლაგი განახლდა: ${data.sku?.canonicalSlug} (ძველი სლაგი ჩაიწერა sku_slug_history-ში [C7, C8])`
        );
        router.refresh();
      }
    } catch {
      setErrorMsg("ქსელური შეცდომა");
    } finally {
      setLoading(false);
    }
  };

  const handleToggleListing = async (storefrontId: string, nextEnabled: boolean) => {
    setLoading(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await fetch("/api/products/listings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storefrontId,
          skuId,
          enabled: nextEnabled,
          reason: "Admin storefront listing toggle (§4.5)"
        })
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setErrorMsg(data.error ?? "ლისტინგის შეცვლა ვერ მოხერხდა");
      } else {
        setStatusMsg("✓ მაღაზიის ლისტინგი განახლდა და LISTING_CHANGED ჩაიწერა Outbox-ში (§4.5)");
        router.refresh();
      }
    } catch {
      setErrorMsg("ქსელური შეცდომა");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: "1.25rem" }}>
      {statusMsg && (
        <div
          style={{
            padding: "0.75rem 1rem",
            background: "#dcfce7",
            color: "#166534",
            borderRadius: "8px",
            fontWeight: 600,
            fontSize: "0.85rem"
          }}
        >
          {statusMsg}
        </div>
      )}
      {errorMsg && (
        <div
          style={{
            padding: "0.75rem 1rem",
            background: "#fee2e2",
            color: "#991b1b",
            borderRadius: "8px",
            fontWeight: 600,
            fontSize: "0.85rem"
          }}
        >
          {errorMsg}
        </div>
      )}

      {/* 1. Lifecycle & Canonical Slug [C7, C8] */}
      <div
        style={{
          padding: "1rem",
          background: "#f8fafc",
          border: "1px solid #cbd5e1",
          borderRadius: "10px",
          display: "flex",
          flexWrap: "wrap",
          gap: "1rem",
          alignItems: "center",
          justifyContent: "space-between"
        }}
      >
        <div>
          <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>
            სტატუსის და `canonical_slug`-ის მართვა ([C7, C8])
          </div>
          <div style={{ fontSize: "0.8rem", color: "#475569", marginTop: "0.2rem" }}>
            მიმდინარე სტატუსი: <strong>{lifecycleState}</strong> · სლაგი:{" "}
            <code>{canonicalSlug ?? "NULL (მინიჭება მოხდება READY-ზე)"}</code>
          </div>
        </div>

        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
          {lifecycleState !== "READY" && (
            <button
              type="button"
              disabled={loading}
              onClick={handleTransitionReady}
              style={{
                padding: "0.5rem 0.9rem",
                background: "#15803d",
                color: "#ffffff",
                border: "none",
                borderRadius: "6px",
                fontWeight: 700,
                cursor: "pointer",
                fontSize: "0.85rem"
              }}
            >
              დამტკიცება → READY (სლაგის გენერაცია [C8])
            </button>
          )}

          {canonicalSlug && (
            <form onSubmit={handleUpdateSlug} style={{ display: "flex", gap: "0.5rem" }}>
              <input
                value={slugInput}
                onChange={(e) => setSlugInput(e.target.value)}
                placeholder="ახალი ASCII სლაგი"
                style={{
                  padding: "0.45rem 0.6rem",
                  borderRadius: "6px",
                  border: "1px solid #cbd5e1",
                  fontSize: "0.85rem",
                  fontFamily: "monospace"
                }}
              />
              <button
                type="submit"
                disabled={loading}
                style={{
                  padding: "0.45rem 0.8rem",
                  background: "#0f172a",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "6px",
                  fontWeight: 600,
                  cursor: "pointer",
                  fontSize: "0.8rem"
                }}
              >
                სლაგის შეცვლა (ისტორიაში ჩაწერით)
              </button>
            </form>
          )}
        </div>
      </div>

      {/* 1b. Manual Identity Confidence Override (Pre-M5, G1 / E2) */}
      {lifecycleState !== "ARCHIVED" && (
        <form
          onSubmit={handleSetConfidenceManually}
          style={{
            padding: "1rem",
            background: "#f8fafc",
            border: "1px solid #cbd5e1",
            borderRadius: "10px",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: "0.75rem",
            alignItems: "end"
          }}
        >
          <label style={{ display: "grid", gap: "0.25rem", fontSize: "0.8rem", fontWeight: 600 }}>
            Confidence-ის ხელით დადგენა (Pre-M5, G1)
            <select
              value={confidenceLevel}
              onChange={(e) => setConfidenceLevel(e.target.value)}
              style={{
                padding: "0.45rem",
                borderRadius: "6px",
                border: "1px solid #cbd5e1",
                fontSize: "0.85rem"
              }}
            >
              <option value="LOW">LOW</option>
              <option value="MEDIUM">MEDIUM</option>
              <option value="HIGH">HIGH</option>
              <option value="CONFLICT">CONFLICT</option>
            </select>
          </label>

          <label style={{ display: "grid", gap: "0.25rem", fontSize: "0.8rem", fontWeight: 600 }}>
            სავალდებულო მიზეზი (`reason`, აისახება აუდიტში)
            <input
              required
              value={confidenceReason}
              onChange={(e) => setConfidenceReason(e.target.value)}
              placeholder="მაგ. დადასტურებულია მწარმოებლის ფირფიტითა და შეფუთვით"
              style={{
                padding: "0.45rem",
                borderRadius: "6px",
                border: "1px solid #cbd5e1",
                fontSize: "0.85rem"
              }}
            />
          </label>

          <button
            type="submit"
            disabled={loading}
            style={{
              padding: "0.5rem 0.9rem",
              background: "#0369a1",
              color: "#ffffff",
              border: "none",
              borderRadius: "6px",
              fontWeight: 700,
              cursor: "pointer",
              fontSize: "0.85rem"
            }}
          >
            Confidence-ის შენახვა (Audit)
          </button>
        </form>
      )}

      {/* 2. Accounting Mapping Form [C9] */}
      <form
        onSubmit={handleAddMapping}
        style={{
          padding: "1rem",
          background: "#f8fafc",
          border: "1px solid #cbd5e1",
          borderRadius: "10px",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: "0.75rem",
          alignItems: "end"
        }}
      >
        <label style={{ display: "grid", gap: "0.25rem", fontSize: "0.8rem", fontWeight: 600 }}>
          იურიდიული პირი (`legal_entity_id` [C9])
          <select
            value={legalEntityId}
            onChange={(e) => setLegalEntityId(e.target.value)}
            style={{
              padding: "0.45rem",
              borderRadius: "6px",
              border: "1px solid #cbd5e1",
              fontSize: "0.85rem"
            }}
          >
            {entities.map((ent) => (
              <option key={ent.id} value={ent.id}>
                {ent.key} — {ent.legalName}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "grid", gap: "0.25rem", fontSize: "0.8rem", fontWeight: 600 }}>
          ბუღალტრული კოდი (`accounting_item_id`, §5.5)
          <input
            required
            value={accountingItemId}
            onChange={(e) => setAccountingItemId(e.target.value)}
            placeholder="1610/00004/0009"
            style={{
              padding: "0.45rem",
              borderRadius: "6px",
              border: "1px solid #cbd5e1",
              fontSize: "0.85rem",
              fontFamily: "monospace"
            }}
          />
        </label>

        <label style={{ display: "grid", gap: "0.25rem", fontSize: "0.8rem", fontWeight: 600 }}>
          ბუღალტრული დასახელება (უცვლელად, §5.5)
          <input
            required
            value={accountingName}
            onChange={(e) => setAccountingName(e.target.value)}
            placeholder="მოტობლოკი HIROMIKI D178E 9HP"
            style={{
              padding: "0.45rem",
              borderRadius: "6px",
              border: "1px solid #cbd5e1",
              fontSize: "0.85rem"
            }}
          />
        </label>

        <label style={{ display: "grid", gap: "0.25rem", fontSize: "0.8rem", fontWeight: 600 }}>
          ძველი კოდი (`legacy_code`, არასავალდებულო)
          <input
            value={legacyCode}
            onChange={(e) => setLegacyCode(e.target.value)}
            placeholder="HM-178E"
            style={{
              padding: "0.45rem",
              borderRadius: "6px",
              border: "1px solid #cbd5e1",
              fontSize: "0.85rem"
            }}
          />
        </label>

        <button
          type="submit"
          disabled={loading}
          style={{
            padding: "0.5rem 0.9rem",
            background: "#1e293b",
            color: "#ffffff",
            border: "none",
            borderRadius: "6px",
            fontWeight: 700,
            cursor: "pointer",
            fontSize: "0.85rem"
          }}
        >
          + მეპინგის შენახვა [C9]
        </button>
      </form>

      {/* 3. Storefront Listings (§4.5) */}
      <div
        style={{
          padding: "1rem",
          background: "#f8fafc",
          border: "1px solid #cbd5e1",
          borderRadius: "10px",
          display: "flex",
          flexWrap: "wrap",
          gap: "1rem",
          alignItems: "center",
          justifyContent: "space-between"
        }}
      >
        <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>
          მაღაზიების ლისტინგი (`storefront_listings`, §4.5):
        </div>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          {storefronts.map((sf) => (
            <button
              key={sf.id}
              type="button"
              disabled={loading}
              onClick={() => handleToggleListing(sf.id, !sf.enabled)}
              style={{
                padding: "0.45rem 0.85rem",
                borderRadius: "6px",
                border: sf.enabled ? "1px solid #16a34a" : "1px solid #94a3b8",
                background: sf.enabled ? "#dcfce7" : "#ffffff",
                color: sf.enabled ? "#166534" : "#334155",
                fontWeight: 700,
                fontSize: "0.8rem",
                cursor: "pointer"
              }}
            >
              {sf.key}: {sf.enabled ? "ჩართულია (Listed ✓)" : "გამორთულია (Unlisted)"}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
