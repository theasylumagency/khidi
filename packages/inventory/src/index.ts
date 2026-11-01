/**
 * [C1, C3] Exact 15 ledger movement types (RETURN_RESTOCK and MANUAL_RESTORE removed per C1).
 */
export const LEDGER_MOVEMENT_TYPES = [
  // Physical (7)
  "STOCK_IN",
  "STOCK_OUT",
  "WRITE_OFF",
  "ADJUSTMENT",
  "PICK_TO_STAGING",
  "RETURN_TO_SHELF",
  "HANDOVER_OUT",
  // Allocation (4)
  "ALLOCATE",
  "DEALLOCATE",
  "TRANSFER_OUT",
  "TRANSFER_IN",
  // Commitment (4)
  "RESERVE",
  "RESERVATION_RELEASE",
  "COMMIT",
  "COMMIT_RELEASE"
] as const;

export type LedgerMovementType = (typeof LEDGER_MOVEMENT_TYPES)[number];
