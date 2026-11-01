# ADR-002: Access Gateway Configuration for Internal PWA, Camera, Offline Queue, and Web Push

- **Status:** Accepted (M1 Spike Baseline)
- **Date:** 2026-11-01
- **Refs:** Technical Specification v1.2 §16.3, Corrections v1.1 `[C6]`

## Context

Per §16.3, AgroTrade Hub runs on a neutral domain behind an access gateway (such as Cloudflare Access or IP allowlist + VPN) so that the admin and warehouse UI is never publicly exposed. However, standard zero-trust gateway login redirects often break Progressive Web Apps (PWAs) on Android (Chrome) and iOS (Safari WebKit) in the following ways:
1. Fetching `/manifest.webmanifest` without credentials triggers a `302` redirect to the gateway identity provider, failing CORS/manifest parsing and blocking "Add to Home Screen" / PWA installation.
2. Service worker script registration (`/sw.js`) fails if redirected or served with an HTML login response instead of `application/javascript`.
3. Web Push notifications delivered via background push events cannot follow interactive gateway login redirects when waking the service worker.

## Decision

1. **Manifest Credential Mode:** The root HTML layout (`apps/hub`) links the web app manifest with `crossorigin="use-credentials"`:
   ```html
   <link rel="manifest" href="/manifest.webmanifest" crossorigin="use-credentials" />
   ```
2. **Gateway Bypass / Service Token Rules for Non-Sensitive PWA Bootstrap Assets Only:**
   In the Access Gateway configuration (e.g., Cloudflare Access Bypass Policy for specific public static paths), exempt **only** the static, non-sensitive PWA bootstrap assets from interactive `302` login redirects:
   - `/manifest.webmanifest`
   - `/sw.js`
   - `/icons/*`
3. **Strict Protection of All HTML, App Routes, and APIs:**
   - All application pages (`/*`), Server Actions, internal API routes (`/api/internal/*`), and media endpoints remain strictly behind both the Access Gateway and the Hub's own server-side session authentication (`packages/auth`).
   - Storefront API routes (`/api/v1/storefront/*`) use server-to-server service tokens (`X-Storefront-Key` + optional Cloudflare Service Token / IP allowlist) and never allow browser CORS requests.
4. **Security & Concealment Headers:**
   Every Hub response includes:
   - `X-Robots-Tag: noindex, nofollow, noarchive`
   - `Content-Security-Policy` with `frame-ancestors 'none'`
   - `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
   - `Permissions-Policy: camera=(self), geolocation=()` (explicitly allowing camera on `self` for barcode scanning and guided photo intake while blocking geolocation).

## Verification Checklist (M1 Gateway Spike on Android & iOS)

A built-in diagnostic page (`/diagnostics/pwa-spike`) is included in `apps/hub` to test and verify all 5 gateway capabilities on real Android and iOS devices:
1. Manifest & Icons load (`installable` check).
2. Service Worker registration & active control (`navigator.serviceWorker.ready`).
3. Camera stream & Torch/BarcodeDetector capability check (`navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })`).
4. IndexedDB offline queue write/read/delete cycle.
5. Web Push VAPID subscription & test push loop.
