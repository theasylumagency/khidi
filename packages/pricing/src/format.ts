/** Browser-safe GEL parsing. Deliberately accepts no grouping separators. */
export function parsePriceInput(raw: string): number | null {
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(raw.trim())) return null;
  const [whole = "0", fraction = ""] = raw.trim().replace(",", ".").split(".");
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(amount) && amount > 0 && amount <= 2_147_483_647 ? amount : null;
}
export function priceInputValue(amount: number): string {
  return `${Math.floor(amount / 100)}.${String(amount % 100).padStart(2, "0")}`;
}
export function formatPrice(amount: number): string {
  const absolute = Math.abs(amount);
  return `${amount < 0 ? "−" : ""}${Math.floor(absolute / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ")},${String(absolute % 100).padStart(2, "0")} ₾`;
}
