# ADR-002: Access Gateway Configuration for Internal PWA, Camera, Offline Queue, and Web Push

- **Status:** Accepted (M1 Spike Baseline)
- **Date:** 2026-11-01
- **Refs:** Technical Specification v1.2 §4.3, §16.3, Corrections v1.1 `[C6]`

## Context

Per §4.3 and §16.3, **Khidi** runs on a neutral domain behind an access gateway (such as Cloudflare Access or IP allowlist + VPN) so that the admin and warehouse UI is never publicly exposed and never reveals legal entity relationships. However, standard zero-trust gateway login redirects and shared warehouse phones introduce specific PWA and security requirements on Android (Chrome) and iOS (Safari WebKit):
1. Fetching `/manifest.webmanifest` without credentials triggers a `302` redirect to the gateway identity provider, failing CORS/manifest parsing and blocking "Add to Home Screen" / PWA installation.
2. iOS Safari requires a raster PNG `<link rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon.png" />` and W3C manifest validation requires separate `"purpose": "any"` and `"purpose": "maskable"` icon entries.
3. On shared warehouse phones where staff switch accounts via personal PIN (`WAREHOUSE_PIN`), caching HTML pages or `/` in a Service Worker could leak one authenticated user's rendered screen to the next user.

## Decision

1. **Manifest Credential Mode & iOS PNG Icons:**
   The root HTML layout (`apps/hub/src/app/layout.tsx`) links the web app manifest with `crossorigin="use-credentials"` and provides a dedicated 180×180 PNG `apple-touch-icon`:
   ```html
   <link rel="manifest" href="/manifest.webmanifest" crossorigin="use-credentials" />
   <link rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon.png" />
   ```
   `/manifest.webmanifest` uses neutral `Khidi` branding and separate `"purpose": "any"` (`icon-192.png`, `icon-512.png`) and `"purpose": "maskable"` (`icon-maskable-512.png`) entries.
2. **Static-Only Service Worker Caching & Logout Purge (`/sw.js`):**
   - `/sw.js` **never** caches `/`, HTML documents (`Accept: text/html`), navigation requests (`request.mode === "navigate"`), or `/api/*` endpoints.
   - Only static assets (`/manifest.webmanifest`, `/icons/*`, `/_next/static/*`) are cached.
   - On logout or warehouse PIN switch, the client posts `{ type: "CLEAR_AUTH_CACHES" }` to `/sw.js` and clears browser caches.
3. **Gateway Bypass / Service Token Rules for Non-Sensitive PWA Bootstrap Assets Only:**
   In the Access Gateway configuration, exempt **only** static bootstrap assets (`/manifest.webmanifest`, `/sw.js`, `/icons/*`) from interactive `302` redirects.
4. **Strict Protection of All HTML, App Routes, and APIs:**
   - All application pages (`/*`), Server Actions, and internal API routes are protected by both the Access Gateway and Khidi's server-side session middleware (`apps/hub/src/middleware.ts`) + `requirePageAuth()` (`@khidi/auth`).
   - All authenticated responses include `Cache-Control: private, no-store, no-cache, must-revalidate`.
5. **Security & Concealment Headers (`apps/hub/next.config.ts`):**
   Every response includes:
   - `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet`
   - `Content-Security-Policy` with `frame-ancestors 'none'` and **no `'unsafe-eval'` in production** (`script-src 'self' 'unsafe-inline'`)
   - `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
   - `Permissions-Policy: camera=(self), geolocation=(), microphone=()`

## Verification Checklist (M1 Gateway Spike on Android & iOS)

A built-in authenticated diagnostic page (`/diagnostics/pwa-spike`) is included in `apps/hub` to test and verify all 5 gateway capabilities on real Android and iOS devices:
1. Manifest & PNG Icons load (`installable` check).
2. Service Worker registration & static-only cache policy (`navigator.serviceWorker.ready`).
3. Camera stream & BarcodeDetector capability check (`navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })`).
4. IndexedDB offline queue write/read/delete cycle.
5. Web Push VAPID subscription & test push loop.
