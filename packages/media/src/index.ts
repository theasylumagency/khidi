export const PHOTO_SLOTS = ["MAIN", "SECONDARY", "IDENTIFICATION", "EXTRA"] as const;
export type PhotoSlot = (typeof PHOTO_SLOTS)[number];
