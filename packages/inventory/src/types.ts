export const LEDGER_MOVEMENT_TYPES = [
  "STOCK_IN", "STOCK_OUT", "WRITE_OFF", "ADJUSTMENT", "PICK_TO_STAGING", "RETURN_TO_SHELF", "HANDOVER_OUT",
  "ALLOCATE", "DEALLOCATE", "TRANSFER_OUT", "TRANSFER_IN", "RESERVE", "RESERVATION_RELEASE", "COMMIT", "COMMIT_RELEASE"
] as const;
export type LedgerMovementType = (typeof LEDGER_MOVEMENT_TYPES)[number];
export type PaymentMethod = "CARD" | "BANK_INSTALLMENT" | "CASH_ON_DELIVERY" | "PAY_ON_PICKUP";
/** Internal primitive input. Approval/scan assertions come from authenticated domain workflows, never a public payload. */
export interface StockMovement {
  type: LedgerMovementType; poolId: string; skuId: string; quantity: number; variant?: string; allocationId?: string;
  reason?: string; documentRef?: string; transferKey?: string;
  reservationId?: string; fulfillmentRequestId?: string; paymentMethod?: PaymentMethod;
  approvedCountLineId?: string; scanConfirmed?: boolean; cancelLostLine?: boolean;
}
