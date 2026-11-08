# M11 security review

Review scope: Hub, worker, private operations and storefront API at the M11 branch.
This is a repository review, not a claim that a deployed server passed its human checks.

- [x] Pages and routes: architecture tests enumerate every page and route; private pages require
  server authentication, mutations validate roles in domain services. The proxy is only a filter.
- [x] Storefront keys: hashed keys, per-storefront scoping, expiry/revocation, trusted-proxy client IP,
  database-backed rate windows and separate API host. Browser Origin is refused on this API.
- [x] **Finding/fix — CSRF:** older private JSON/CSV mutations and password/PIN login did not all
  require the configured browser origin. Private body readers now require exact origin, reject
  cross-site fetch metadata and require JSON MIME for JSON. Multipart uploads check origin too.
  The server-to-server storefront reader deliberately remains separate. Real browser POSTs send Origin.
- [x] Cookies: session/device/remembered-key cookies are HttpOnly, SameSite and Secure in production;
  credential responses (including PIN, registration and logout) use no-store.
- [x] CSP and headers: production has no unsafe-eval; development-only eval and the existing
  ADR-002 inline-script allowance remain explicit. Robots, frame, MIME and referrer headers remain.
- [x] Rate limits: office/PIN failures lock the account after five failures for 15 minutes;
  storefront keys have atomic rate windows. The operations runbook also requires proxy IP limits
  on public authentication, including invalid/unrecognized accounts and setup tokens.
- [x] Uploads: actual streamed bytes are bounded, photo formats/decoding/pixel limits are checked,
  and original bytes are immutable. PDF evidence remains private and INTERNAL_ONLY, never AI input.
- [x] **Finding/fix — body limits:** H1 bounds actual bytes before parsing, rejects compression,
  caps nesting/collection sizes before Zod, and adds explicit schema caps. Proxy limits are defense
  in depth, not a prerequisite for application limits. Oversized auth bodies return 413.
- [x] Responses: unknown errors produce generic responses, never driver errors or stacks.
  PIN/device errors now use translated safe messages. Evidence/content validation retains only
  intentional actionable review details. Operations no longer print raw driver exceptions.
- [x] Logs: runtime worker/queue errors are fixed messages; operations failures do not serialize
  database exceptions, secrets or bound parameters. Audit export redaction is separately tested.
  Media retry/dead-letter records keep only a safe error code; a regression covers wrapped
  database errors containing private query parameters.
  Do not enable HTTP request-body/query/cookie logging on the production proxy.
- [x] **Finding/fix — SSRF:** one shared public-address policy now also refuses 192.0.0.0/24,
  192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24 and 192.88.99.0/24, and IPv6 special-purpose
  ranges. Webhook and push DNS are bounded and pinned; no redirects; response bytes are bounded.
  Only explicit development localhost receivers are exempt; no production override exists.
- [x] Signed media: short-lived authenticated private access, SHA-256 on immutable reads;
  storefront projections use only approved public derivatives, never raw/evidence/Hub URLs.
- [x] Append-only audit/outbox/slug/ledger/price history is protected by grants and triggers.
  Migrations remain frozen; M11 adds migrations only.
- [x] Dependencies remain exact-pinned; see [audit and residual Zod risk](dependency-audit.md).

H9 adds token-based setup and strong-authenticated user management with its own lifecycle tests.
The final PR records the exact verification totals. Deployment configuration, real devices,
backup recovery and production key handling require the owner checklist; local success is not
substituted for those checks.
