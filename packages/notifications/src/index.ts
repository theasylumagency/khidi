export const NOTIFICATION_LEVELS = ["INFO", "ACTION_REQUIRED", "CRITICAL"] as const;
export type NotificationLevel = (typeof NOTIFICATION_LEVELS)[number];
