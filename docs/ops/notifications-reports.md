# Notifications, push and reports

## Web Push setup

Web Push is optional per user and browser/device. Users enable it from the notification
center using an explicit button; INFO requires a separate opt-in. No prompt is triggered
automatically. On iPhone use the installed PWA when the browser lacks PushManager.

Before enabling M10 on a shared server, generate a new VAPID pair locally with the pinned
`web-push` library's `generateVAPIDKeys()`. Save its output directly to a new protected file
(mode 0600/owner-only ACL), then configure the protected service environment manually:

- `NEXT_PUBLIC_VAPID_PUBLIC_KEY`: generated public key;
- `VAPID_PRIVATE_KEY`: matching private key; never commit, paste into chat or include in logs;
- `VAPID_SUBJECT=https://app.khidi.app`.

The known development keys in `.env.example` are refused in production. Both Hub and
worker fail before starting work if production keys are missing, mismatched or development
defaults. Key rotation requires browsers to re-enable their subscriptions. No environment
file or deployment is changed by the implementation.

Subscription capability URLs and client keys are encrypted with the existing protected
encryption key. They are not included in audit/idempotency responses. Registry records
belong to the actual user, session and device. Logout deletes the session and cascades the
subscription; device revocation and shared-device user switches also remove subscriptions.
The browser unsubscribes on leaving a session. Background push can reach an opted-in
inactive device while its absolute session is valid; opening a link still requires login.

The worker creates separate durable delivery intents and sends outside transactions with
leases, bounded requests, pinned public DNS, exponential retries and an eight-attempt
limit. HTTP 404/410 removes the subscription without deleting the in-app notification.
Lock-screen payloads contain only Khidi, a generic Georgian body and an authorized deep
link, never amounts, prices, customer data, supplier names or evidence readings. A delivery
can repeat after a crash; no business operation is performed by receiving a push.

Dependencies were verified against npm publication metadata: `web-push` 3.6.7
(2024-01-16) and its type definitions 3.6.4 (2024-10-22), both older than two weeks.
[Library](https://www.npmjs.com/package/web-push/v/3.6.7),
[types](https://www.npmjs.com/package/@types/web-push/v/3.6.4).

## Installment reminders

The ADMIN-only notification-center setting defaults to 24 hours. Only BANK_INSTALLMENT
reservations still uncommitted are eligible. Each exact expiry timestamp can produce one
notice; extending creates a new eligible expiry, and creation/extension already inside
the lead window emits immediately. Other deadlines are checked by the worker. Recipients
must be ADMIN/ORDER_MANAGER members of the seller entity. The notice does not extend a
reservation; only the storefront's existing API command does that.
## Movement reports

After migrations, run media:jobs:deploy as hub_migrator to register the daily-report queue,
dead-letter queue and 00:05 Asia/Tbilisi schedule. The worker uses hub_app and enables the
pg-boss scheduler without runtime migrations. The previous completed Tbilisi day is frozen
once per legal entity. Retries reuse the frozen snapshot and fill only missing CSV/XLSX
files; the ready notification is emitted once, after both files exist.

Reports use the same private storage, versioning, replication and backup coverage as media,
under reports/<random UUIDv7>/. Include this prefix in backup/restore verification.
No report file is public. Download links expire after five minutes, are bound to the signed-in
user, and recheck current reports.view/entity membership; copying a link cannot grant access.
Ready reports are available under Reports. ADMIN configures daily recipients per existing
entity membership; other recipients also need reports.view. No email is sent.

If the worker was offline at the scheduled time, run pnpm reports:daily YYYY-MM-DD for each
missed completed date, with the worker's database/storage configuration. This is idempotent.
Investigate report-dead-letter via the audit screen, fix storage/database availability, then
use the same command for the failed date. Do not run tests or seeds on a shared server.
The task does not deploy this schedule or worker to a shared environment.

Storage writes precede the append-only file-reference transaction. A crash at that boundary
can leave an unreferenced private immutable object; retry creates a fresh random object key.
Do not automatically delete such files or overwrite them. Referenced snapshots/files never
change; verify stored SHA-256 on every download.
