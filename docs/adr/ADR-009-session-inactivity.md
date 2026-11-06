# ADR-009 — Idle limits for authenticated Hub sessions

Status: Accepted — owner-approved PR #9 follow-up.

Office sessions (password/TOTP or passkey) expire after 20 minutes without confirmed activity.
Warehouse PIN sessions expire after 10 minutes. The existing absolute limits (12 and 4 hours)
still apply. Every protected request uses the earlier deadline; settings and passkey operations
also recheck it when they acquire the session lock. Neither ordinary activity nor the idle
deadline supplies or refreshes recent strong authentication.

`0014_session_inactivity.sql` adds one timestamp with a database default. For sessions already
present, applying the migration starts one initial idle window because the previous release
recorded no activity history. Absolute expiry still applies. The default also lets the
previous binary insert sessions during rollback without undoing the migration.

The normal principal lookup is read-only. In the browser, trusted pointer/touch activation,
keyboard editing, navigation clicks, deliberate scrolling and actual scanner/photo capture
events may send a same-origin authenticated activity request. Camera frames, queue sync,
polling, focus, visibility changes, service-worker requests and health probes cannot renew.
Focus, reconnect, browser history restoration and other tabs' notifications use status only.
The server doesn't treat an activity request as proof of human presence or as a strong factor.

Session activity is disposable authentication metadata, not a business mutation. A
session-scoped compare-and-set supplies idempotency without an audit/outbox row or stored
response per event: the cookie and expected session ID select the row, and only the current
activity revision can advance. A replay or concurrent tab gets the current status. A
30-second minimum interval coalesces writes on the server; the browser also sends at most
one ordinary attempt per interval. There is no trailing/background keepalive timer. The
last event within a coalesced interval may not be recorded, so the UI can warn up to roughly
30 seconds earlier than measured from the last individual interaction.

After locking, the server checks the original idle and absolute deadlines again at the
renewal statement. Expired rows are logically invalid and cannot renew. The browser cannot
provide its own activity timestamp. Scoped logout and renewal reject stale tab identities;
logout keeps the registered-device cookie. Other tabs reconcile against the server, rather
than accepting a broadcast as authorization. No tokens, passwords, codes or drafts travel
over the tab channel. A new login issues a new session normally, including after idle expiry.

An accessible dialog appears about a minute before the effective deadline. Continue is an
explicit server request. A warning at the absolute limit lets the user return to save before
expiry, without extending it. After the estimated deadline, a disconnected tab is blocked
pending a server check and keeps its existing in-memory form state. Once invalidation is
confirmed, clear authentication caches and return to login. No pending form is submitted,
and IndexedDB scan/photo queues and ownership rules remain unchanged. The old monitor ends
when the TOTP enrollment flow intentionally closes the session; confirmation creates a new one.

See [office passkeys operations](../ops/office-passkeys.md) for rollout and rollback, including
how to prevent idle-expired sessions becoming usable again under the previous binary.
