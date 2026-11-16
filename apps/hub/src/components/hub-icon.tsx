import type { SVGProps } from "react";

const paths: Record<string, string> = {
  overview: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  products: "m12 3 9 5v9l-9 5-9-5V8l9-5Z M3 8l9 5 9-5 M12 13v9 M7.5 5.5l9 5v4",
  inventory: "M3 21V7l9-4 9 4v14 M7 21V11h10v10 M7 15h10 M7 19h10",
  prices: "M20 13 11 22 2 13V4h9l9 9Z M7 8h.01",
  tasks: "M8 4H5v17h14V4h-3 M8 3h8v4H8z M8 12l2 2 5-5 M8 18h7",
  fulfillment: "M3 5h11v12H3z M14 9h4l3 4v4h-7 M7 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4 M17 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4",
  reports: "M4 3v18h17 M8 17v-6 M13 17V7 M18 17V4",
  notifications: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4",
  history: "M3 11a9 9 0 1 1 2 7 M3 4v7h7 M12 7v5l3 2",
  settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M10 2h4l1 3 3 1 3 3-2 3 2 3-3 3-3 1-1 3h-4l-1-3-3-1-3-3 2-3-2-3 3-3 3-1 1-3Z",
  evidence: "M5 3h10l4 4v14H5z M14 3v5h5 M8 13h8 M8 17h5",
  users: "M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M2 21v-3a7 7 0 0 1 14 0v3 M17 4a4 4 0 0 1 0 7 M19 15a5 5 0 0 1 3 5v1",
  legal_entities: "M4 21V3h12v18 M16 9h4v12 M8 7h4 M8 11h4 M8 15h4 M9 21v-3h2v3",
  storefronts: "M3 9 5 3h14l2 6 M3 9h18v3a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0V9Z M5 15v6h14v-6 M10 21v-5h4v5",
  arrow: "M5 12h14 M13 6l6 6-6 6",
  arrowUp: "M6 18 18 6 M6 6h12v12",
  search: "M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15 M16 16l5 5",
  security: "m12 3 8 3v6c0 5-8 10-8 10S4 17 4 12V6l8-3Z M8 12l3 3 5-6",
  scan: "M8 3H3v5 M16 3h5v5 M3 16v5h5 M21 16v5h-5 M7 8v8 M11 8v8 M14 8v8 M17 8v8",
  calendar: "M3 5h18v16H3z M7 2v6 M17 2v6 M3 11h18 M8 15h2 M14 15h2",
  chevron: "m9 5 7 7-7 7",
  close: "m6 6 12 12 M6 18 18 6",
  menu: "M4 6h16 M4 12h16 M4 18h16",
  check: "m5 12 4 4L19 6",
  logout: "M10 3H4v18h6 M9 12h12 M17 8l4 4-4 4"
};

export function HubIcon({ name, ...props }: SVGProps<SVGSVGElement> & { name: string }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>
    <path d={paths[name] ?? paths.products} />
  </svg>;
}
