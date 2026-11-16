# Khidi workspace design — 15 November 2026

Maintenance UI work on top of the responsive design in Draft PR #20, targeting the
M11 candidate. This is not a new business milestone or authorization to deploy.

## Experience

- Forest-green navigation, warm paper surfaces, restrained lime highlights and a custom
  architectural bridge engraving shared by sign-in and the workspace overview.
- Georgian-first type hierarchy, a personal greeting, Tbilisi date, existing live summary
  values, role-aware shortcuts and an honest unconfigured state for an absent relationship.
- Navigation icons, product search using the existing catalog query, section breadcrumbs,
  active states, a mobile disclosure menu and Escape-to-close with focus restoration.
- A common presentation layer for tables, forms, summaries, empty states and actions.
- Catalog rows retain every existing field and action; lifecycle states use Georgian labels.
  The wide catalog scrolls in its own keyboard-focusable region.
- Static inline SVG illustration, no external image/font requests, no added dependencies.
  Entrance and hover motion respect reduced-motion preferences. Print hides navigation.

The change keeps all domain operations, routes, API permissions, auth procedures, stock,
pricing, fulfillment and offline/camera workflows. No migrations or ADRs are needed.

## Verification

All 21 workspaces passed TypeScript (also the repository's per-workspace lint command),
and dependency boundaries passed. Forty focused presentation/lifecycle/architecture tests
plus the two i18n tests passed. No full database integration run is claimed for this
presentation-only change. A production webpack run compiled successfully, but full build
acceptance remains open: subsequent packaging failed with EPERM creating a directory under
`.next/server/app/api/products/confidence`.

The Windows sandbox's native realpath operation
returns EPERM for readable workspace junctions. Local verification uses Node's ordinary
realpath implementation in place of its native variant, without disabling TypeScript or
architecture checks. The pinned pnpm bootstrap cannot download its distribution here;
the already-installed project tools are invoked directly.

Browser QA is **pending**. The local Next.js server starts, but loopback requests return
EACCES and the browser times out. After the owner started Docker, its named pipe still
returns permission denied in this session. A standalone visual harness compiled from the
actual UI components was prepared, but local-file navigation is blocked by browser policy.
No screenshot, real-device pass or database integration pass is claimed.

## Required visual acceptance

- Desktop at 1440 and 1280 pixels: login, overview, catalog/product detail, inventory,
  pricing, fulfillment, tasks, evidence, reports, history, users and settings.
- Mobile at 390 and 320 pixels: menu open/close/route change/Escape, no document-level
  horizontal overflow, local table scrolling, 16px form fields and usable touch targets.
- Keyboard: skip link, catalog search, visible focus, expandable sections and table scrolling.
- Login: welcome/password/PIN/passkey variations, validation, TOTP and activation views.
- Actual Android and iPhone/PWA: camera overlay, guided capture, offline status, dialogs
  and session warnings. Retain the existing thermal-label print/scan acceptance gate.
- Reduced motion and 200% zoom; long Georgian names, empty data and populated tables.

The verification harness and sample data remain ignored local QA files, never app routes
or production data. The authenticated dashboard continues to use the existing database reads.
