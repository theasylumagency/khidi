export const REPORT_FORMATS = ["CSV", "XLSX"] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];
