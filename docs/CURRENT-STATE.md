# Khidi — current implementation

M11 is the last planned milestone. The M11 candidate is reviewed through a Draft PR;
implementation and local verification do not authorize deployment or certify the pilot.
Use this file alongside the accepted ADRs and the [operations runbook](ops/server-setup.md).

Khidi is the private canonical catalog, evidence/media registry, accounting mapping and
storefront base-price source. Each storefront is scoped to its seller entity and configured
availability pool. It consumes a versioned server-to-server API; public projections never
expose shared-Hub, supplier, accounting or customer details. Customer personal data is not stored.

## Working model

- Intake: existing identifiers match; no-barcode intake can create an unverified draft.
  Business exceptions are durable Class A review records and never mutate the catalog.
  Technical/security failures remain in the per-user offline queue with explicit discard reports.
  Merged labels follow guarded lineage; split labels require review and replacement labels.
- Identity: deterministic evidence rules, not an AI confidence score. Both identity kinds
  require variant safety. Without documents, verified reference photos and an observable
  ADMIN_PHYSICAL_INSPECTION can produce HOUSE_DEFINED/MEDIUM and explicitly admin-confirmed
  READY. Non-observable power cannot be established by appearance; unknown is legitimate.
  Pending evidence reveals candidates/conflicts only; accepted evidence is immutable and a
  correction supersedes/rejects the old item atomically. AI readings have job provenance and
  require explicit per-field human confirmation. Private PDFs remain internal.
- AI: provider-independent jobs, processed EXIF-free master/large derivative input only,
  never raw originals, invoices, prices or INTERNAL_ONLY evidence. Per-job cost reservation
  and a daily cap apply. Only synthetic/disabled providers exist; shared servers keep AI disabled.
- Content: immutable locale versions and separate approval. Automated validation protects
  verified brands/models/recognized technical quantities and confidentiality. It imposes no
  vocabulary, script, spelling, transliteration or style restrictions. Human approvers own language.
  A referenced fact changing or losing verification suspends only affected locales; READY,
  canonical slug, old versions and unaffected locales stay intact.
- Publishing: publish-ready and sellable are separate evaluations per storefront/locale.
  READY/identity, approved current content, verified public main image and enabled listing
  establish publication; actual seller/owner mappings, allocation and current base price
  determine sellability. Unknown data never becomes invented prices or stock.
- Stock: authorized users declare free-to-sell availability per storefront. The Hub derives
  atomic ledger deltas, protects reserved/committed units and other storefront allocations,
  and does not measure physical stock or connect to accounting. Low-stock requests inform;
  only an explicit new declaration changes availability. Advanced transfers remain ADMIN-only.
- Orders: one reservation and one complete fulfillment request, including bundles. No partial
  shipments or consolidation in M9. The default simplified policy completes the canonical
  ledger workflow at the storefront's confirmation and reports AUTO_ASSUMED. CARD/installment
  confirm at COMMIT; COD/pickup confirm at RESERVE, without asserting payment collection.
  Controlled fulfillment is implemented/tested in the domain, with warehouse UI deferred.
  Mode freezes per reservation. Storefront clients never depend on or change the Hub mode.
- Reports: seller date is COMMIT, owner date is HANDOVER_OUT, using immutable accounting/VAT/
  final-price snapshots and provenance. Before-handover cancellations use their agreed correction
  dates; a composed bundle has one money correction on fulfillment cancellation, components
  remain unpriced quantity lines on actual movement dates. Bundles require a single owner;
  defensive mixed-owner output excludes an undetermined header amount from owner totals.
  Private daily CSV/XLSX files, in-app/push notifications and scoped/redacted audit history exist.
- People: one global role plus memberships and granular permissions. H9 adds ADMIN-only,
  recent-strong-authenticated user changes, one-time employee setup, mandatory TOTP for every
  new office account and registered-device warehouse PIN setup. Deactivation/reset/access
  changes revoke obsolete sessions immediately; no user deletion. See user-management.md.
- Reference/configuration: H10 installs the eight public categories, internal UNCLASSIFIED
  and 33 approved types with a previewable, audited reference-data command. Real legal entities,
  stores, pools and relationships are created through ADMIN UI, never seeds or a business-data
  command. ACCESSORY/POWER_TOOL/FARM_PROCESSOR permit audited KA/EN subtype additions with no
  required specs until the owner defines them. Reference updates preserve these additions.
- Identification capture distinguishes actual photos, checked plate absence and later capture.
  Engine/generator plates are separate. PLATE_ABSENT is an attributed NOT_FOUND observation,
  not a technical reading; accepted evidence wins. LATER stays pending. Admin review asks for
  documents/supplier evidence for absence, not a nonexistent plate reshoot. Class A stays
  intake-only until resolution; HOUSE_DEFINED/MEDIUM/confirmed READY still works without plates.

## Accepted decisions and superseded text

| Decision | Current rule / older assumption replaced |
| --- | --- |
| ADR-001 | One global role plus entity memberships; no per-entity role matrix in Phase 1 (§13.1/C12). |
| ADR-002 | Access protects the app host; only manifest/SW/icons bypass interactive redirects. Static-only SW caching; production CSP has no unsafe-eval (§13.3/§16.2). |
| ADR-003 | First-party opaque database sessions, encrypted TOTP and registered-device PIN replace the suggested auth-library choice in specification §2/§13.2. |
| ADR-004 | Encrypted pgBackRest full backups plus WAL and isolated recovery verification implement §16.7; M11 extends checks to current tables/files and recovered-state E2E. |
| ADR-005 | Durable Class A review replaces rejection of physical business-exception scans (§5.3–5.4/§7/§16.5); merge/split amendments preserve original scan history. |
| ADR-006 | Write-once private raw/evidence/master/report objects, separate public derivatives, versioning/retention/replication and object recovery (§8/§12.3/§16.7). |
| ADR-007 | Native photo capture and automatic durable local acceptance supersede the original photo stream/second-confirmation UI (§8.1). Server Tier-1 quality is advisory; safe format/size/decoder/pixel checks remain (§8/M4 P4). |
| ADR-008 | User-verified platform passkeys, recent strong proof and guided TOTP/security operations extend §13.2; passkeys may sync, so revocation is not physical-phone blocking. H9's owner decision requires TOTP for all new office accounts. |
| ADR-009 | Office idle limit 20 minutes and PIN idle limit 10, within existing 12/4-hour absolute deadlines. Passive polling/camera frames do not renew; activity is not strong authentication (§13.2). |
| ADR-010 | Evidence-derived field/identity confidence replaces AGENTS E2 and plan F1's universal brand/model requirement, specification §5.10/§6.1–6.4/§15.1. Legacy/later LOW or CONFLICT retains READY/slug with re-verification; identity conflict blocks sale. |
| ADR-011 Part A | Pre-inventory split with structured differences, supporting candidates, attributions and split-label review replaces the M6 blanket split deferral. Inventory history still forbids split until Part B is accepted. |
| ADR-012 | Positive structured sameness replaces a free-note/no-known-difference merge. Unknown-side attributes stay flagged/unpublished until evidence from that side verifies agreement. |
| ADR-013 | Declared online limits replace specification §10.1/§10.4/§10.11 and plan M8 I5/I6/I9 physical-count/Rule A scope. Marked online shelves (C13) and plan risk R2's physical reconciliation assumption do not apply. Ledger invariants/locks remain. |
| ADR-014 | One workflow, simplified by default, replaces mandatory warehouse confirmation in specification §11.2–11.3, plan M9 R8 and the corresponding C1/C4/C14/C16/C18 execution assumptions. Controlled domain rules remain; physical UI is deferred. |

Specification §17.3's old pilot scenarios are replaced by M11 H6 A–D, documented in
[E2E verification](ops/e2e-verification.md). Specification §17.2's seeds are developer fixtures,
never shared-server setup. Production setup is roles → migrations → queue deployment →
reviewed reference-data application → interactive first ADMIN, then real business configuration
and H9 second ADMIN. The M6 owner clarifications separately define fact-snapshot suspension,
the four content checks and distinct
publication/sale evaluations. Accepted ADRs override the older plan on their topics.

## Remaining decisions and pilot gates

- #2: Hub ownership and operating contract require the owners' agreement.
- #8: a bundle's total price is not allocated among its components. Reports never invent a split.
- ADR-011 Part B remains Proposed: no split with inventory/reservations/fulfillment history.
- M9 R8 controlled warehouse picking/manual-confirmation UI is deferred; switching to controlled
  mode does not create that missing interface. Partial fulfillment/consolidation need a new ADR.
- Physical counts, physical reconciliation and accounting imports remain future extensions.
- Daily report email delivery is deferred; files, in-app notification and opted-in push exist.
- Proposed ADR-015: Zod 4 migration. The residual high advisory is mitigated, not declared patched;
  see [dependency audit](security/dependency-audit.md). No unsupported provider is introduced.
- Annex A's complete subtype/spec tables for ACCESSORY, POWER_TOOL and FARM_PROCESSOR remain
  open until the owner reviews the first intake wave. Existing vocabularies remain; new ADMIN
  additions have empty required-spec lists. Later owner-approved requirements are applied with
  the same reference-data command, without schema changes. Gloves classification remains open.
- Catalog source subcategories/filters are recommendations, not implemented public navigation.
  Compatibility, fit_status, engine_models, uses_engine, inheritance, spec matching, two-stage
  publishing and parts finder require a separate milestone/ADR. WordPress IDs remain hints only.
- [Pre-pilot checklist](ops/pre-pilot-checklist.md): real-server restore, physical phones behind
  the gateway, offline ownership, printer, keys, second ADMIN and secure API-key handover.

Accepted risks must be explained: declared stock can exceed physical stock (ADR-013), and
AUTO_ASSUMED is not proof of physical shipment. After-confirmation cancellations/returns/refunds
remain outside Khidi; corrected availability is a new authorized declaration (ADR-014).
