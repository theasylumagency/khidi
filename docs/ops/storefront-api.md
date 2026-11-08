# Storefront API v1

The existing Hub and worker remain bound to loopback. The API uses api.khidi.app;
the private Hub uses app.khidi.app. Keep gateway policy on the admin host. The API
is server-to-server with its own bearer keys; browser Origin requests are refused
and no CORS headers are emitted. Never put keys into storefront browser code.

Set KHIDI_API_HOST=api.khidi.app in production (development default:
api.localhost:3100). A route checks the actual Host and ignores X-Forwarded-Host.
The proxy also refuses every admin page/route on the API host; page/session and
public-auth/health guards independently refuse it. Unknown hosts are rejected by
the reverse proxy's default virtual host. The protected environment stays outside Git.

Provision a random KHIDI_PROXY_TOKEN of at least 32 characters in both the Hub
environment and an owner-readable reverse-proxy include. The proxy **overwrites**
X-Khidi-Client-IP and X-Khidi-Proxy-Token. An unverified IP header has no authority;
keys with an IP allowlist fail closed without a verified IP. If a CDN/gateway is
in front, configure real-IP handling for its explicitly trusted source ranges first;
never trust arbitrary X-Forwarded-For or an unrestricted real-IP source range.

Example routing inside the existing HTTPS virtual hosts (TLS/gateway provisioning
remains infrastructure work; this file does not deploy anything):

```nginx
# default_server: return 444; server_name _;
# app.khidi.app:
location ^~ /api/v1/storefront/ { return 404; }
location / {
    proxy_pass http://127.0.0.1:3100;
    proxy_set_header Host $host;
}
# api.khidi.app:
location ^~ /api/v1/storefront/ {
    proxy_pass http://127.0.0.1:3100;
    proxy_set_header Host $host;
    proxy_set_header X-Khidi-Client-IP $remote_addr;
    include /etc/khidi/api-proxy-token.conf;
    # include contains: proxy_set_header X-Khidi-Proxy-Token "<protected token>";
}
location / { return 404; }
```

ADMIN manages keys with a recent strong office session. Raw keys are shown once;
only their SHA-256 is retained, including in idempotency receipts. A repeated issue
request returns metadata without recovering the secret; rotate if the first response
was lost. Rotation creates a replacement and revokes the old key atomically. Expiry,
revocation and exact-IP allowlists are checked on every request. The configurable
per-key limit defaults to 120 requests/minute and is enforced in PostgreSQL across
all Hub processes. A 429 response includes Retry-After. Replays count as requests.

Every POST requires a UUID Idempotency-Key and strict JSON. No customer fields are
accepted. Generate the OpenAPI document with ops/storefront-openapi.ts or read it
through an authenticated GET /api/v1/storefront/{store}/openapi.

COD/PICKUP includes confirmation in RESERVE. CARD/BANK includes it in COMMIT.
The confirmation shape is identical in both modes: deliveryMethod, shipBy and final
prices for the original cart items. Handle REQUESTED and HANDED_OVER/AUTO_ASSUMED
without knowing the Hub's mode. POST fulfillment-requests ensures the complete
request already created by that confirmation; it cannot confirm an unpaid order,
split a shipment or create a second request. Bundle components remain private.
RESERVATION_EXPIRED is HTTP 409: refund or create a new reservation, never retry a
late payment as a fresh commit. Handed-over orders cannot restore stock through this API.

Product/price/stock lists use a UUID cursor, limit (1–100), locale and optional
updated_since UTC timestamp. Follow nextCursor even when a filtered page is empty.
Unpublished deltas are tombstones; GET of a non-public or foreign product is 404.
Public prices and stock come only from the storefront's own projection. No Hub,
accounting, evidence, component or supplier details are included.

## Signed webhooks

An ADMIN configures each storefront's HTTPS endpoint and receives a random secret once.
It is encrypted at rest; rotating it replaces the signing secret for later attempts.
The worker independently delivers each `storefront:<id>` consumer. Catalog fan-out also
covers changes that originally had no external consumer. Notification, AI and media
delivery state is independent. No response body from a receiver is stored.

The envelope has `id`, `schemaVersion: 1`, `type`, `occurredAt` and a public `data`
projection. A bundle update never exposes its private component rows. Fulfillment events
retain `AUTO_ASSUMED`, `SCAN` or `MANUAL` provenance and the status of that event.
Receivers verify `X-Khidi-Signature: v1=<hex>` using HMAC-SHA256 over
`X-Khidi-Timestamp + "." + exact UTF-8 body`, reject timestamps outside five minutes,
then deduplicate `id`. A delivery's body is immutable across retries. Delivery is at
least once; a crash after acceptance can cause a duplicate.

Workers claim 30-second leases, send outside transactions with a five-second timeout,
never follow redirects, and pin DNS to an allowed destination. Production endpoints
must use HTTPS with public addresses; development permits loopback HTTP for the test
client. Failures back off exponentially (2 seconds initially, capped at one hour).
After eight failed/abandoned attempts the delivery is DEAD_LETTER. An ADMIN may retry it;
the audit and append-only attempt history remain, with the same event id and bytes.
Disabling an endpoint leaves pending events durable until it is enabled again.
