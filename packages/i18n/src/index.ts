import type { SupportedLocale, UserRole } from "@khidi/shared";

export interface NavItem {
  key: string;
  href: string;
  labelKa: string;
  labelEn: string;
  adminOnly?: boolean;
  allowedRoles: UserRole[];
}

/**
 * Primary navigation items matching §13.4.
 * Core: პროდუქტები · მარაგი · ფასები · დავალებები · მიწოდება · შეტყობინებები · ისტორია · პარამეტრები
 * Admin additionally: მტკიცებულებები, მომხმარებლები, იურიდიული პირები, მაღაზიები, ანგარიშები
 */
export const NAVIGATION_ITEMS: readonly NavItem[] = [
  {
    key: "products",
    href: "/products",
    labelKa: "პროდუქტები",
    labelEn: "Products",
    allowedRoles: ["ADMIN", "OPERATOR", "STOCK_MANAGER"]
  },
  {
    key: "inventory",
    href: "/inventory",
    labelKa: "მარაგი",
    labelEn: "Inventory",
    allowedRoles: ["ADMIN", "OPERATOR", "STOCK_MANAGER", "WAREHOUSE"]
  },
  {
    key: "prices",
    href: "/prices",
    labelKa: "ფასები",
    labelEn: "Prices",
    allowedRoles: ["ADMIN", "OPERATOR"]
  },
  {
    key: "tasks",
    href: "/tasks",
    labelKa: "დავალებები",
    labelEn: "Tasks",
    allowedRoles: ["ADMIN", "OPERATOR", "STOCK_MANAGER", "WAREHOUSE"]
  },
  {
    key: "fulfillment",
    href: "/fulfillment",
    labelKa: "მიწოდება",
    labelEn: "Fulfillment",
    allowedRoles: ["ADMIN", "OPERATOR", "WAREHOUSE", "ORDER_MANAGER"]
  },
  {
    key: "notifications",
    href: "/notifications",
    labelKa: "შეტყობინებები",
    labelEn: "Notifications",
    allowedRoles: ["ADMIN", "OPERATOR", "STOCK_MANAGER", "WAREHOUSE", "ORDER_MANAGER"]
  },
  {
    key: "history",
    href: "/history",
    labelKa: "ისტორია",
    labelEn: "Audit History",
    allowedRoles: ["ADMIN", "OPERATOR", "STOCK_MANAGER"]
  },
  {
    key: "settings",
    href: "/settings",
    labelKa: "პარამეტრები",
    labelEn: "Settings",
    adminOnly: true,
    allowedRoles: ["ADMIN"]
  },
  // Admin-only navigation items (§13.4)
  {
    key: "evidence",
    href: "/evidence",
    labelKa: "მტკიცებულებები",
    labelEn: "Evidence",
    adminOnly: true,
    allowedRoles: ["ADMIN"]
  },
  {
    key: "users",
    href: "/users",
    labelKa: "მომხმარებლები",
    labelEn: "Users",
    adminOnly: true,
    allowedRoles: ["ADMIN"]
  },
  {
    key: "legal_entities",
    href: "/entities",
    labelKa: "იურიდიული პირები",
    labelEn: "Legal Entities",
    adminOnly: true,
    allowedRoles: ["ADMIN"]
  },
  {
    key: "storefronts",
    href: "/storefronts",
    labelKa: "მაღაზიები",
    labelEn: "Storefronts",
    adminOnly: true,
    allowedRoles: ["ADMIN"]
  },
  {
    key: "reports",
    href: "/reports",
    labelKa: "ანგარიშები",
    labelEn: "Reports",
    adminOnly: false,
    allowedRoles: ["ADMIN", "STOCK_MANAGER"]
  }
] as const;

export function getNavigationForRole(role: UserRole): NavItem[] {
  return NAVIGATION_ITEMS.filter((item) => item.allowedRoles.includes(role));
}

export const DICTIONARY = {
  ka: {
    "app.title": "Khidi — სასაწყობო და კატალოგის ჰაბი",
    "app.subtitle": "კანონიკური პროდუქტების, მარაგების, ფასებისა და შესრულების ცენტრი",
    "auth.office_login": "ოფისის შესვლა (ელ-ფოსტა + TOTP)",
    "auth.warehouse_pin": "საწყობის სწრაფი შესვლა (PIN)",
    "auth.logout": "გასვლა",
    "warehouse.scan_accepted": "✓ კოდი მიღებულია",
    "warehouse.next_scan": "შემდეგი პროდუქტის სკანირება",
    "warehouse.photo_blurry": "⚠ ფოტო ბუნდოვანია, გადაიღეთ თავიდან",
    "warehouse.offline_pending": "ოფლაინ რიგშია სინქრონიზაციისთვის",
    "settings.operating_model_title": "ონლაინ საწყობის ოპერაციული მოდელი (§10.1, C1, C13)",
    "settings.operating_model_rule1": "1. ბუღალტერიაში იქმნება გამოყოფილი ონლაინ საწყობი/ლოკაცია, სადაც შიდა გადაადგილებით გადადის ონლაინ გასაყიდი მარაგი.",
    "settings.operating_model_rule2": "2. თითოეული პულის SHELF (თარო) და STAGING (აგროვებული შეკვეთების ზონა) ფიზიკურად მარკირებულია, რათა პერსონალმა მკაფიოდ გაარჩიოს მფლობელი იურიდიული პირები (PURCHASE რეჟიმში) [C13].",
    "settings.operating_model_rule3": "3. გადაცემის (HANDED_OVER) შემდეგ დაბრუნებული პროდუქცია მიდის მხოლოდ მთავარ საწყობში და არასდროს ბრუნდება პირდაპირ ონლაინ თაროზე. ხელახალი ონლაინ გაყიდვისთვის საჭიროა ახალი STOCK_IN დოკუმენტის ნომრით [C1]."
  },
  en: {
    "app.title": "Khidi — Online Warehouse & Catalog Hub",
    "app.subtitle": "Canonical Product Master, Inventory, Pricing & Fulfillment Hub",
    "auth.office_login": "Office Login (Email + TOTP)",
    "auth.warehouse_pin": "Warehouse Quick Switch (PIN)",
    "auth.logout": "Sign out",
    "warehouse.scan_accepted": "✓ კოდი მიღებულია",
    "warehouse.next_scan": "შემდეგი პროდუქტის სკანირება",
    "warehouse.photo_blurry": "⚠ ფოტო ბუნდოვანია, გადაიღეთ თავიდან",
    "warehouse.offline_pending": "Pending offline sync",
    "settings.operating_model_title": "Online Warehouse Operating Model (§10.1, C1, C13)",
    "settings.operating_model_rule1": "1. A dedicated online warehouse is maintained in accounting and online units are transferred there.",
    "settings.operating_model_rule2": "2. Each pool's SHELF and STAGING zones are physically marked so staff can distinguish legal entity owners [C13].",
    "settings.operating_model_rule3": "3. Returned goods after HANDED_OVER go to the main warehouse, never directly back to the online shelf without a new STOCK_IN document reference [C1]."
  }
} as const;

export type TranslationKey = keyof typeof DICTIONARY.ka;

export function t(key: TranslationKey, locale: SupportedLocale = "ka", isWarehouseUi = false): string {
  // Warehouse UI is always Georgian (§13.5)
  const effectiveLocale: SupportedLocale = isWarehouseUi ? "ka" : locale;
  return DICTIONARY[effectiveLocale][key] ?? DICTIONARY.ka[key];
}
