import type { ReactNode } from "react";
import { t } from "@khidi/i18n";

export function TableScroll({ children, label = t("ui.table") }: { children: ReactNode; label?: string }) {
  return <div className="hub-table-scroll" role="region" aria-label={label} tabIndex={0}>{children}</div>;
}
