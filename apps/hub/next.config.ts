import type { NextConfig } from "next";

export function buildContentSecurityPolicy(
  isProduction: boolean = process.env.NODE_ENV === "production"
): string {
  const scriptSrc = isProduction
    ? "script-src 'self' 'unsafe-inline'"
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";

  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'"
  ].join("; ");
}

export function getSecurityHeaders(
  isProduction: boolean = process.env.NODE_ENV === "production"
) {
  return [
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
      value: buildContentSecurityPolicy(isProduction)
    }
  ] as const;
}

export const SECURITY_HEADERS = getSecurityHeaders(true);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    "@khidi/shared",
    "@khidi/db",
    "@khidi/domain",
    "@khidi/auth",
    "@khidi/catalog-review",
    "@khidi/entities",
    "@khidi/products",
    "@khidi/publishing",
    "@khidi/evidence",
    "@khidi/media",
    "@khidi/scanning",
    "@khidi/ai",
    "@khidi/pricing",
    "@khidi/inventory",
    "@khidi/fulfillment",
    "@khidi/reservations",
    "@khidi/reports",
    "@khidi/notifications",
    "@khidi/i18n",
    "@khidi/ui"
  ],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [...getSecurityHeaders(process.env.NODE_ENV === "production")]
      }
    ];
  }
};

export default nextConfig;
