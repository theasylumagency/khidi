"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface ProductTypeOption {
  id: string;
  key: string;
  nameKa: string;
  nameEn: string;
}

export function ProductCreateForm({
  productTypes
}: {
  productTypes: ProductTypeOption[];
}) {
  const router = useRouter();
  const [productTypeId, setProductTypeId] = useState(productTypes[0]?.id ?? "");
  const [brand, setBrand] = useState("");
  const [modelCode, setModelCode] = useState("");
  const [keyDifferentiatorKa, setKeyDifferentiatorKa] = useState("");
  const [keyDifferentiatorEn, setKeyDifferentiatorEn] = useState("");
  const [power, setPower] = useState("");
  const [workingWidth, setWorkingWidth] = useState("");
  const [weight, setWeight] = useState("");
  const [isKit, setIsKit] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/products/skus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productTypeId: productTypeId || undefined,
          brand,
          modelCode,
          keyDifferentiatorKa,
          keyDifferentiatorEn,
          power,
          workingWidth,
          weight,
          isKit
        })
      });
      const data = (await res.json()) as { error?: string; sku?: { id: string } };
      if (!res.ok) {
        setError(data.error ?? "SKU-ს შექმნა ვერ მოხერხდა");
        setLoading(false);
        return;
      }
      setBrand("");
      setModelCode("");
      setKeyDifferentiatorKa("");
      setKeyDifferentiatorEn("");
      setPower("");
      setWorkingWidth("");
      setWeight("");
      setIsKit(false);
      router.refresh();
    } catch {
      setError("ქსელური შეცდომა SKU-ს შექმნისას");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
        gap: "0.75rem",
        alignItems: "end"
      }}
    >
      <label style={{ display: "grid", gap: "0.25rem", fontSize: "0.8rem", fontWeight: 600 }}>
        პროდუქტის ტიპი (§5.8)
        <select
          value={productTypeId}
          onChange={(e) => setProductTypeId(e.target.value)}
          style={{
            padding: "0.5rem",
            borderRadius: "6px",
            border: "1px solid #cbd5e1",
            fontSize: "0.85rem"
          }}
        >
          <option value="">— არაკლასიფიცირებული (UNCLASSIFIED) —</option>
          {productTypes.map((pt) => (
            <option key={pt.id} value={pt.id}>
              {pt.nameKa} ({pt.key})
            </option>
          ))}
        </select>
      </label>

      <label style={{ display: "grid", gap: "0.25rem", fontSize: "0.8rem", fontWeight: 600 }}>
        ბრენდი (მაგ. WEIMA, HIROMIKI)
        <input
          value={brand}
          onChange={(e) => setBrand(e.target.value)}
          placeholder="HIROMIKI"
          style={{
            padding: "0.5rem",
            borderRadius: "6px",
            border: "1px solid #cbd5e1",
            fontSize: "0.85rem"
          }}
        />
      </label>

      <label style={{ display: "grid", gap: "0.25rem", fontSize: "0.8rem", fontWeight: 600 }}>
        მოდელის კოდი
        <input
          value={modelCode}
          onChange={(e) => setModelCode(e.target.value)}
          placeholder="D178E-DF900Q"
          style={{
            padding: "0.5rem",
            borderRadius: "6px",
            border: "1px solid #cbd5e1",
            fontSize: "0.85rem"
          }}
        />
      </label>

      <label style={{ display: "grid", gap: "0.25rem", fontSize: "0.8rem", fontWeight: 600 }}>
        განმასხვავებელი (KA, §5.10)
        <input
          value={keyDifferentiatorKa}
          onChange={(e) => setKeyDifferentiatorKa(e.target.value)}
          placeholder="9 ცხ.ძ., რეზინის ბორბლებით"
          style={{
            padding: "0.5rem",
            borderRadius: "6px",
            border: "1px solid #cbd5e1",
            fontSize: "0.85rem"
          }}
        />
      </label>

      <label style={{ display: "grid", gap: "0.25rem", fontSize: "0.8rem", fontWeight: 600 }}>
        განმასხვავებელი (EN)
        <input
          value={keyDifferentiatorEn}
          onChange={(e) => setKeyDifferentiatorEn(e.target.value)}
          placeholder="9 HP, Rubber Wheels"
          style={{
            padding: "0.5rem",
            borderRadius: "6px",
            border: "1px solid #cbd5e1",
            fontSize: "0.85rem"
          }}
        />
      </label>

      <label style={{ display: "grid", gap: "0.25rem", fontSize: "0.8rem", fontWeight: 600 }}>
        სიმძლავრე (§5.6, მაგ. 9 HP → 6.62 kW)
        <input
          value={power}
          onChange={(e) => setPower(e.target.value)}
          placeholder="9 HP"
          style={{
            padding: "0.5rem",
            borderRadius: "6px",
            border: "1px solid #cbd5e1",
            fontSize: "0.85rem"
          }}
        />
      </label>

      <label style={{ display: "grid", gap: "0.25rem", fontSize: "0.8rem", fontWeight: 600 }}>
        სამუშაო სიგანე (მაგ. 110 cm → 1100 mm)
        <input
          value={workingWidth}
          onChange={(e) => setWorkingWidth(e.target.value)}
          placeholder="110 cm"
          style={{
            padding: "0.5rem",
            borderRadius: "6px",
            border: "1px solid #cbd5e1",
            fontSize: "0.85rem"
          }}
        />
      </label>

      <label style={{ display: "grid", gap: "0.25rem", fontSize: "0.8rem", fontWeight: 600 }}>
        წონა (მაგ. 135 kg)
        <input
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
          placeholder="135 kg"
          style={{
            padding: "0.5rem",
            borderRadius: "6px",
            border: "1px solid #cbd5e1",
            fontSize: "0.85rem"
          }}
        />
      </label>

      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.4rem",
          fontSize: "0.8rem",
          fontWeight: 600,
          paddingBottom: "0.4rem"
        }}
      >
        <input
          type="checkbox"
          checked={isKit}
          onChange={(e) => setIsKit(e.target.checked)}
        />
        ქარხნული კომპლექტი (`is_kit`)
      </label>

      <button
        type="submit"
        disabled={loading}
        style={{
          padding: "0.55rem 1rem",
          background: "#15803d",
          color: "#ffffff",
          border: "none",
          borderRadius: "6px",
          fontWeight: 700,
          cursor: loading ? "wait" : "pointer",
          fontSize: "0.85rem"
        }}
      >
        {loading ? "იქმნება..." : "+ ახალი SKU (INTAKE, slug=NULL [C8])"}
      </button>

      {error && (
        <div style={{ gridColumn: "1 / -1", color: "#b91c1c", fontSize: "0.85rem" }}>
          {error}
        </div>
      )}
    </form>
  );
}
