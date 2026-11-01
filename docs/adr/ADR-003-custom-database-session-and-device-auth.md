# ADR-003: First-Party Database-Backed Session, TOTP, and Registered-Device PIN Authentication

- **Status**: Accepted
- **Date**: 2026-11-01
- **References**: Technical Specification v1.2 §2, §13.1, §13.2, §16.3

## Context
Technical Specification §2 recommends an established authentication approach (such as Auth.js or the Lucia session pattern), while §13.2 requires two distinct authentication modes tailored to the physical warehouse and office operations of Khidi:
1. **Office & Management Users (`ADMIN`, `STOCK_MANAGER`, `OPERATOR`, `ORDER_MANAGER`)**:
   - Email + bcrypt password + mandatory RFC 6238 TOTP (`otpauth`) for `ADMIN` and `STOCK_MANAGER` (and optional for `OPERATOR`).
   - 12-hour database-backed sessions (`OFFICE_PASSWORD_TOTP`).
2. **Shared Warehouse Phones / Scanners (`WAREHOUSE`, `ADMIN`)**:
   - Devices must first be explicitly registered by an `ADMIN` (`registered_devices` table with a SHA-256 hashed device token stored in an `HttpOnly` cookie on the physical device).
   - Once a phone is registered, warehouse staff authenticate and rapidly switch active users on the same device using a personal 4–6 digit PIN (`WAREHOUSE_PIN`) with short-lived 4-hour sessions.
   - Revoking a registered device immediately invalidates all active sessions tied to that `device_id`.
3. **Storefront Service-to-Service API (`storefront_api_keys`)**:
   - SHA-256 hashed scoped API keys (`sf_<storefront>_...`) with strict per-storefront isolation and optional IP allowlists.

Note that the `lucia` npm package was officially deprecated by its author in 2024/2025 in favor of implementing Lucia's documented first-party database session table pattern directly in application code, whereas OAuth-centric libraries (like NextAuth/Auth.js) introduce complex stateless JWT defaults and do not natively model dual-cookie registered hardware devices (`khidi_device_token` + `khidi_session`) with fast PIN user switching and transactional audit logging (`audit_logs`).

## Decision
We adopt the **Lucia first-party database session architecture** implemented directly in `@khidi/auth` (`packages/auth/src/index.ts`) backed by PostgreSQL 18 tables (`users`, `sessions`, `registered_devices`, `storefront_api_keys`) and wired into `apps/hub` via Next.js 16 Middleware/Proxy and server-side session guards:

1. **Opaque Session Tokens Hashed at Rest**:
   - Raw session tokens (`khidi_sess_<64_hex>` or `khidi_wsess_<64_hex>`) are generated with 256 bits of cryptographic randomness (`node:crypto.randomBytes(32)`) and transmitted only in `HttpOnly`, `SameSite=Lax`, `Secure` (in production) cookies (`khidi_session`).
   - Only the SHA-256 digest (`sessions.token_hash`) is stored in PostgreSQL, preventing session hijacking even if database backups or read replicas are inspected.
2. **AES-256-GCM Encrypted TOTP Secrets at Rest**:
   - `users.totp_secret_encrypted` stores RFC 6238 Base32 TOTP secrets encrypted with **AES-256-GCM** (`v1:<iv_hex>:<auth_tag_hex>:<ciphertext_hex>`) using `HUB_TOTP_ENCRYPTION_KEY`.
   - Plaintext TOTP secrets are never persisted in PostgreSQL.
3. **Atomic Brute-Force Lockout in PostgreSQL**:
   - Both office login (`failed_login_attempts`, `login_locked_until`) and warehouse PIN login (`failed_pin_attempts`, `pin_locked_until`) use single-statement atomic SQL increments (`failed_*_attempts = failed_*_attempts + 1`) that lock the credential for 15 minutes after 5 consecutive failures, avoiding read-modify-write race conditions.
4. **Immediate Server-Side Revocation & Shared-Device Cache Isolation**:
   - Logging out (`POST /api/auth/logout`) or switching warehouse users deletes the row from `sessions`, clears the `khidi_session` cookie, and instructs the Service Worker (`/sw.js`) to purge any client caches.
   - `sw.js` never caches HTML documents or navigation responses, ensuring shared warehouse phones never leak one operator's rendered view to another.

## Consequences
- **Positive**:
  - Full transactional integration with `withDomainTransaction()` and `audit_logs` on every login, logout, device registration, and device revocation.
  - Zero third-party auth framework deserialization surface or opaque JWT state; every request verifies `sessions` and `registered_devices` status in PostgreSQL.
- **Negative / Mitigations**:
  - `@khidi/auth` owns session lifecycle maintenance directly, requiring comprehensive automated tests (`packages/auth/src/auth.test.ts`) covering TOTP encryption, atomic lockouts, device revocation, RBAC, and entity isolation.
