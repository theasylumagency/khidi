import type { LedgerMovementType } from "./types.ts";

export type Deltas = readonly [shelf: number, staging: number, allocTotal: number, allocated: number, reserved: number, committed: number];
export type Preconditions = "NONE" | "UNALLOCATED" | "AVAILABLE" | "COUNT" | "NEGATIVE_COUNT" | "RESERVE" | "RELEASE_RESERVED" | "COMMIT" | "RELEASE_COMMITTED" | "PICK" | "RETURN" | "HANDOVER" | "LOST_RESERVED" | "LOST_COMMITTED" | "TRANSFER_IN";
export interface MatrixRow { type: LedgerMovementType; variant: string; deltas: Deltas; precondition: Preconditions; allocation: boolean; location: "SHELF" | "STAGING" | null }

/** C3 + C14. All coefficients are multiplied by a strictly positive integer n. */
export const MOVEMENT_MATRIX: readonly MatrixRow[] = [
  { type: "STOCK_IN", variant: "DEFAULT", deltas: [1,0,0,0,0,0], precondition: "NONE", allocation: false, location: "SHELF" },
  { type: "STOCK_OUT", variant: "DEFAULT", deltas: [-1,0,0,0,0,0], precondition: "UNALLOCATED", allocation: false, location: "SHELF" },
  { type: "WRITE_OFF", variant: "DEFAULT", deltas: [-1,0,0,0,0,0], precondition: "UNALLOCATED", allocation: false, location: "SHELF" },
  { type: "ADJUSTMENT", variant: "SHELF_INCREASE", deltas: [1,0,0,0,0,0], precondition: "COUNT", allocation: false, location: "SHELF" },
  { type: "ADJUSTMENT", variant: "SHELF_DECREASE", deltas: [-1,0,0,0,0,0], precondition: "NEGATIVE_COUNT", allocation: false, location: "SHELF" },
  { type: "ADJUSTMENT", variant: "STAGING_RESERVED", deltas: [0,-1,-1,-1,-1,0], precondition: "LOST_RESERVED", allocation: true, location: "STAGING" },
  { type: "ADJUSTMENT", variant: "STAGING_COMMITTED", deltas: [0,-1,-1,-1,0,-1], precondition: "LOST_COMMITTED", allocation: true, location: "STAGING" },
  { type: "ALLOCATE", variant: "DEFAULT", deltas: [0,0,1,1,0,0], precondition: "UNALLOCATED", allocation: true, location: null },
  { type: "DEALLOCATE", variant: "DEFAULT", deltas: [0,0,-1,-1,0,0], precondition: "AVAILABLE", allocation: true, location: null },
  { type: "TRANSFER_OUT", variant: "SAME_POOL", deltas: [0,0,-1,-1,0,0], precondition: "AVAILABLE", allocation: true, location: null },
  { type: "TRANSFER_IN", variant: "SAME_POOL", deltas: [0,0,1,1,0,0], precondition: "TRANSFER_IN", allocation: true, location: null },
  { type: "TRANSFER_OUT", variant: "CROSS_POOL", deltas: [-1,0,0,0,0,0], precondition: "UNALLOCATED", allocation: false, location: "SHELF" },
  { type: "TRANSFER_IN", variant: "CROSS_POOL", deltas: [1,0,0,0,0,0], precondition: "TRANSFER_IN", allocation: false, location: "SHELF" },
  { type: "RESERVE", variant: "DEFAULT", deltas: [0,0,0,0,1,0], precondition: "RESERVE", allocation: true, location: null },
  { type: "RESERVATION_RELEASE", variant: "DEFAULT", deltas: [0,0,0,0,-1,0], precondition: "RELEASE_RESERVED", allocation: true, location: null },
  { type: "COMMIT", variant: "DEFAULT", deltas: [0,0,0,0,-1,1], precondition: "COMMIT", allocation: true, location: null },
  { type: "COMMIT_RELEASE", variant: "DEFAULT", deltas: [0,0,0,0,0,-1], precondition: "RELEASE_COMMITTED", allocation: true, location: null },
  { type: "PICK_TO_STAGING", variant: "DEFAULT", deltas: [-1,1,0,0,0,0], precondition: "PICK", allocation: true, location: "STAGING" },
  { type: "RETURN_TO_SHELF", variant: "DEFAULT", deltas: [1,-1,0,0,0,0], precondition: "RETURN", allocation: true, location: "SHELF" },
  { type: "HANDOVER_OUT", variant: "DEFAULT", deltas: [0,-1,-1,-1,0,-1], precondition: "HANDOVER", allocation: true, location: "STAGING" }
];
