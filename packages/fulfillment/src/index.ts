export const FULFILLMENT_STATUSES = [
  "REQUESTED",
  "PICKING",
  "PICKED",
  "ACTION_REQUIRED",
  "HANDED_OVER",
  "CANCELLED"
] as const;

export type FulfillmentStatus = (typeof FULFILLMENT_STATUSES)[number];
