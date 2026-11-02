"use client";

export function PrintLabelButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      style={{
        padding: "0.5rem 1rem",
        background: "#15803d",
        color: "#ffffff",
        border: "none",
        borderRadius: "8px",
        fontWeight: 700,
        cursor: "pointer",
        fontSize: "0.85rem"
      }}
    >
      🖨 ბეჭდვა (58×40 მმ)
    </button>
  );
}
