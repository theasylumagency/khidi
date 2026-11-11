import type { UserRole } from "@khidi/shared";

export interface StatusBadgeDescriptor {
  label: string;
  tone: "neutral" | "success" | "warning" | "danger" | "info";
}

export function getRoleBadge(role: UserRole): StatusBadgeDescriptor {
  switch (role) {
    case "ADMIN":
      return { label: "ADMIN · ადმინისტრატორი", tone: "danger" };
    case "STOCK_MANAGER":
      return { label: "STOCK_MANAGER · მარაგის მენეჯერი", tone: "info" };
    case "OPERATOR":
      return { label: "OPERATOR · ოპერატორი", tone: "success" };
    case "WAREHOUSE":
      return { label: "WAREHOUSE · საწყობი", tone: "warning" };
    case "ORDER_MANAGER":
      return { label: "ORDER_MANAGER · შეკვეთების მენეჯერი", tone: "neutral" };
    case "CATALOG_REVIEWER":
      return { label: "CATALOG_REVIEWER · კატალოგის მიმომხილველი", tone: "neutral" };
  }
}
