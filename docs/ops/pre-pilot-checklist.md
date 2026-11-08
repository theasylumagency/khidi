# Pre-pilot acceptance — owner record

Complete against the exact release SHA being deployed. Local automated results are in the
M11 milestone record and restore-result JSON; they do not tick these real-environment boxes.
Record date, owner and sanitized evidence for each item. Never attach passwords, setup links,
QR/TOTP secrets, session cookies, API/webhook keys or unredacted private document screenshots.

## Recovery and configuration

- [ ] Real production backup/WAL archive is current, encrypted, retained at least 30 days,
  off-server and monitored. Recovery cipher and access are independently recoverable.
- [ ] Owner restored the real backup and private object replica to an isolated environment,
  checked migration checksums/table counts, inventory rebuild and raw/master/derivative/
  evidence/report SHA-256. H6 runs only on a separate writable `_test` clone; no tests/seeds
  run on the shared server or recovered original. Restored workers/outbox delivery stay off.
- [ ] Production versioning, COMPLIANCE Object Lock, deletion protection, encryption and
  second-location replication are verified. A real replicated sample is readable with the
  expected SHA-256; runtime cannot delete private versions or weaken protection.
- [ ] Fresh production TOTP encryption, media-signing/proxy and matching VAPID keys are set;
  public build-time VAPID key matches runtime. No development defaults. Deployment preflight
  and app/worker runtime preflights pass without granting runtime migration/backup privileges.
- [ ] RP/origin are app.khidi.app / https://app.khidi.app; API host is api.khidi.app.
  App-only Access gateway, static bootstrap exceptions, TLS, trusted-proxy headers/IP handling,
  body/time/rate limits, neutral naming and safe log rotation are verified.
- [ ] New install can configure real legal entities, taxonomy/types, storefronts, accounting
  mappings and availability pools without development seeds. Any missing configuration UI
  remains a pilot blocker until explicitly resolved; do not improvise reference data.

## People and access

- [ ] First ADMIN completed TOTP. A second independent ADMIN was created through H9,
  received its private single-use link, completed TOTP and signed in successfully.
- [ ] Office setup tested on Android/iPhone: password manager, matching password confirmation,
  guided TOTP, refresh/retry, used/expired/reissued links and explicit sign-out when a different
  account is already open. No session appears before TOTP confirmation.
- [ ] Warehouse setup tested on an active registered phone: numeric PIN entry, no credential
  autofill/save offer for a shared PIN, normal personal sign-in and user switch. Unregistered
  or revoked devices cannot activate/use the PIN.
- [ ] Role/membership/permission changes end old sessions; deactivation ends all sessions/push
  and pending links; reactivation restores no old session. Credential reset requires fresh setup
  and revokes passkeys. Self-demotion/deactivation and last-admin removal are refused.
- [ ] Passkey enable/remember-name/rename/revoke and fallback work; a synced key is described
  as a key, not one physical phone. Revoking from another device ends key-derived access.
- [ ] Break-glass ops:recover-user access and private interactive procedure are available;
  no recovery credentials or enrollment secrets are kept in logs/tickets.

## Real Android and installed iPhone PWA, behind the gateway

- [ ] Install/bootstrap icons, service worker update and fresh load/navigation after restart
  have no hydration errors. Runtime chunks/HTML/private APIs are not cached by the worker.
- [ ] Barcode scan, native rear-camera and gallery return/cancel/retake work; no lost file
  after backgrounding/lock. Required slots, missing-photo completion and duplicate behavior
  match the task. Device quality success survives server advisory disagreement.
- [ ] Offline scan plus photos survive closing/reopening, upload in dependency order and keep
  per-user ownership after switching accounts. Class A reaches admin review; Class B remains
  visible. Explicit scan discard includes photo count; no silent blob deletion.
- [ ] Storage-persistence request/quota warnings and blocked-photo retake/discard are usable.
- [ ] Real Web Push works with the production keys and explicit consent/INFO choice on both
  platforms; payload is generic. Logout/deactivation/user switch does not notify the old user.
- [ ] Office idle/absolute expiry and warehouse idle expiry work after PWA return; passive
  polling and camera frames do not keep sessions alive. Unsaved work is not auto-submitted.

## Labels, storefront and business sign-off

- [ ] Actual 58 × 40 mm thermal print is legible and scans on both devices. KH-only neutral
  labels, attachment confirmation, merged-label resolution and split-label replacement tested.
- [ ] API key handed privately to each storefront's server operator; keys never enter browser
  bundles. Own-store scope, optional verified-IP allowlist, rotation, idempotency and signed
  webhook deduplication tested with that operator. Storefront handles REQUESTED and
  HANDED_OVER/AUTO_ASSUMED without knowing the Hub mode.
- [ ] Accounting/VAT/base-price mappings and consignment owner/seller configuration reviewed;
  reports show snapshot values and provenance. No invented component price allocation.
- [ ] Client understands ADR-013: availability is their conservative declaration; Khidi cannot
  detect physical shortage or offline sales. Staff know who updates each storefront's limits.
- [ ] Client understands ADR-014: AUTO_ASSUMED is automatic policy completion, not physical
  shipment or COD payment collection. After-confirmation cancellations/returns/refunds stay
  outside Hub; re-entry requires an authorized availability declaration. Controlled warehouse
  UI, physical counts and inventory split remain unavailable.
- [ ] Missing-document products may reach MEDIUM via observable inspection, but appearance
  cannot verify power. Indistinguishable variants can remain blocked until evidence resolves them.
- [ ] Owner accepts the documented residual Zod advisory/mitigations and tracks Proposed ADR-015;
  remaining contractual/ownership and bundle-allocation decisions are recorded.

Release SHA: __________  Date: __________  Owner: __________

Pilot approval: __________  Unresolved blockers: __________
