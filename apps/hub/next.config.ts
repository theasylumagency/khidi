import type { NextConfig } from "next";

export const SECURITY_HEADERS = [
  {
    key: "X-Robots-Tag",
    value: "noindex, nofollow, noarchive, nosnippet"
  },
  {
    key: "X-Frame-Options",
    value: "DENY"
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff"
  },
  {
    key: "Referrer-Policy",
    value: "no-referrer"
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload"
  },
  {
    key: "Permissions-Policy",
    value: "camera=(self), geolocation=(), microphone=()"
  },
  {
    key: "Content-Security-Policy",
    value:
      "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  }
] as const;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    "@agrotrade/shared",
    "@agrotrade/db",
    "@agrotrade/domain",
    "@agrotrade/auth",
    "@agrotrade/entities",
    "@agrotrade/products",
    "@agrotrade/publishing",
    "@agrotrade/evidence",
    "@agrotrade/media",
    "@agrotrade/scanning",
    "@agrotrade/ai",
    "@agrotrade/pricing",
    "@agrotrade/inventory",
    "@agrotrade/fulfillment",
    "@agrotrade/reports",
    "@agrotrade/notifications",
    "@agrotrade/i18n",
    "@agrotrade/ui"
  ],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [...SECURITY_HEADERS]
      }
    ];
  }
};

export default nextConfig;
