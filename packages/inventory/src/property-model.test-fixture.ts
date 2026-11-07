/** Independent oracle: individual units, not the engine's matrix or aggregate arithmetic. */
export interface Unit {
  allocation: number | null;
  line: number | null;
  committed: boolean;
  request: number | null;
}
export interface StockModel { units: Unit[] }
export const operations = ["in", "out", "writeOff", "allocate", "deallocate", "reserve", "release",
  "commit", "releaseCommit", "pick", "return", "handover", "lostReserved", "lostCommitted",
  "transfer", "increase", "decrease"] as const;
export type Operation = typeof operations[number];
export interface Command {
  op: Operation;
  store: number;
  line: number;
  request: number;
  quantity: number;
  malformed?: boolean;
}
export type Outcome = "APPLIED" | "REJECTED" | "REQUIRES_DEALLOCATION" | "CRITICAL";
export const isCod = (line: number) => line % 2 === 1;
export const lineIndex = (c: Pick<Command, "store" | "line">) => c.store * 4 + c.line;
export const free = (u: Unit, store: number) => u.allocation === store && u.line === null;
export const unassigned = (u: Unit) => u.allocation === null;
export const onLine = (u: Unit, c: Command) => u.allocation === c.store && u.line === lineIndex(c);
const fresh = (): Unit => ({ allocation: null, line: null, committed: false, request: null });

export function totals(m: StockModel) {
  const count = (p: (u: Unit) => boolean) => m.units.filter(p).length;
  return {
    pool: { shelf: count((u) => u.request === null), staging: count((u) => u.request !== null),
      allocatedTotal: count((u) => u.allocation !== null), unallocated: count(unassigned) },
    allocations: [0, 1].map((store) => ({ allocated: count((u) => u.allocation === store),
      reserved: count((u) => u.allocation === store && u.line !== null && !u.committed),
      committed: count((u) => u.allocation === store && u.committed), availableToSell: count((u) => free(u, store)) }))
  };
}

// Capacity is used only to generate boundary values. Invalid commands are executed, never filtered out.
export function capacity(m: StockModel, c: Omit<Command, "quantity">) {
  const line = (u: Unit) => onLine(u, { ...c, quantity: 1 });
  switch (c.op) {
    case "out": case "writeOff": case "allocate": case "decrease": return m.units.filter(unassigned).length;
    case "deallocate": case "reserve": case "transfer": return m.units.filter((u) => free(u, c.store)).length;
    case "commit": return m.units.filter((u) => line(u) && !u.committed).length;
    case "release": return m.units.filter((u) => line(u) && !u.committed && u.request === null).length;
    case "releaseCommit": return m.units.filter((u) => line(u) && u.committed && u.request === null).length;
    case "pick": return m.units.filter((u) => line(u) && u.request === null && (isCod(c.line) || u.committed)).length;
    case "return": return m.units.filter((u) => line(u) && u.request === c.request).length;
    case "handover": return m.units.filter((u) => line(u) && u.request === c.request && (isCod(c.line) || u.committed)).length;
    case "lostReserved": return isCod(c.line) ? m.units.filter((u) => line(u) && !u.committed && u.request === c.request).length : 0;
    case "lostCommitted": return m.units.filter((u) => line(u) && u.committed && u.request === c.request).length;
    default: return 4;
  }
}

export function modelBatch(before: StockModel, commands: readonly Command[]): { outcome: Outcome; model: StockModel } {
  if (commands.some((c) => !Number.isInteger(c.quantity) || c.quantity <= 0 || c.op === "transfer" && c.malformed)) {
    return { outcome: "REJECTED", model: before };
  }
  const m = structuredClone(before);
  for (const c of commands) {
    if (!Number.isInteger(c.quantity) || c.quantity <= 0) return { outcome: "REJECTED", model: before };
    const n = c.quantity;
    const take = (predicate: (u: Unit) => boolean) => m.units.filter(predicate).slice(0, n);
    const line = (u: Unit) => onLine(u, c);
    let selected: Unit[];
    switch (c.op) {
      case "in": case "increase":
        if (c.malformed && c.op === "increase") return { outcome: "REJECTED", model: before };
        m.units.push(...Array.from({ length: n }, fresh)); continue;
      case "decrease": {
        if (c.malformed) return { outcome: "REJECTED", model: before };
        const loose = m.units.filter(unassigned).length;
        if (n > loose) {
          const freeUnits = m.units.filter((u) => u.allocation !== null && u.line === null).length;
          const shelf = m.units.filter((u) => u.request === null).length;
          return { outcome: n > shelf || n > loose + freeUnits ? "CRITICAL" : "REQUIRES_DEALLOCATION", model: before };
        }
        selected = take(unassigned); break;
      }
      case "out": case "writeOff":
        if (c.malformed) return { outcome: "REJECTED", model: before };
        selected = take(unassigned); break;
      case "allocate":
        selected = take(unassigned); if (selected.length !== n) return { outcome: "REJECTED", model: before };
        for (const u of selected) u.allocation = c.store; continue;
      case "deallocate": case "transfer":
        if (c.malformed && c.op === "transfer") return { outcome: "REJECTED", model: before };
        selected = take((u) => free(u, c.store)); if (selected.length !== n) return { outcome: "REJECTED", model: before };
        for (const u of selected) u.allocation = c.op === "transfer" ? 1 - c.store : null; continue;
      case "reserve":
        if (c.malformed) return { outcome: "REJECTED", model: before };
        selected = take((u) => free(u, c.store)); if (selected.length !== n) return { outcome: "REJECTED", model: before };
        for (const u of selected) u.line = lineIndex(c); continue;
      case "release": case "releaseCommit":
        selected = take((u) => line(u) && u.request === null && u.committed === (c.op === "releaseCommit"));
        if (selected.length !== n) return { outcome: "REJECTED", model: before };
        for (const u of selected) { u.line = null; u.committed = false; } continue;
      case "commit":
        // C4: COD commits only as part of the handover command below.
        if (isCod(c.line)) return { outcome: "REJECTED", model: before };
        selected = take((u) => line(u) && !u.committed); if (selected.length !== n) return { outcome: "REJECTED", model: before };
        for (const u of selected) u.committed = true; continue;
      case "pick":
        selected = take((u) => line(u) && u.request === null && (isCod(c.line) || u.committed));
        if (selected.length !== n) return { outcome: "REJECTED", model: before };
        for (const u of selected) u.request = c.request; continue;
      case "return":
        if (c.malformed) return { outcome: "REJECTED", model: before };
        selected = take((u) => line(u) && u.request === c.request); if (selected.length !== n) return { outcome: "REJECTED", model: before };
        for (const u of selected) u.request = null; continue;
      case "handover":
        if (c.malformed && isCod(c.line)) return { outcome: "REJECTED", model: before };
        selected = take((u) => line(u) && u.request === c.request && (isCod(c.line) || u.committed)); break;
      case "lostReserved": case "lostCommitted":
        if (c.malformed || c.op === "lostReserved" && !isCod(c.line)) return { outcome: "REJECTED", model: before };
        selected = take((u) => line(u) && u.request === c.request && u.committed === (c.op === "lostCommitted")); break;
    }
    if (selected.length !== n) return { outcome: "REJECTED", model: before };
    m.units = m.units.filter((u) => !selected.includes(u));
  }
  return { outcome: "APPLIED", model: m };
}

export function modelAvailability(before: StockModel, store: number, target: number) {
  if (!Number.isInteger(target) || target < 0) return { outcome: "REJECTED" as const, model: before };
  const current = before.units.filter((u) => free(u, store)).length;
  const m = structuredClone(before);
  if (target > current) m.units.push(...Array.from({ length: target - current }, () => ({ ...fresh(), allocation: store })));
  else {
    const removed = m.units.filter((u) => free(u, store)).slice(0, current - target);
    m.units = m.units.filter((u) => !removed.includes(u));
  }
  return { outcome: "APPLIED" as const, model: m };
}
