# M11 H10 — reference catalog and initial ADMIN configuration

Follow-up to Draft PR #18 on m11-hardening. Owner decisions on 2026-11-08 define the exact
approved catalog subset; docs/catalog/README.md records the statuses. No shared database,
environment, gateway, WordPress records or real business configuration is changed by this work.

## Comparison with taxonomy.ts before H10

| Area | Before | Approved change / boundary |
| --- | --- | --- |
| Categories | Eight public categories + internal UNCLASSIFIED | Same keys, labels, ordering and default mappings; no second-level public navigation or filters. |
| Original 30 types | Match Architecture v1.0's type→category matrix | All 30 keys/mappings retained. No SKU reclassification or WordPress import. |
| GENERATOR | Missing | Add Workshop/Construction type; OPEN_FRAME/INVERTER/ENCLOSED; distinct rated/max kW, fuel, phase, V/Hz, start, plain engine-model reading, optional displacement/AVR/tank/sockets/weight and source-stated power factor. Store approved naming/research contract; never infer a start method from a suffix or kVA conversion without source power factor. |
| Generator photos | Three generic role slots | Main/front; secondary panel plus start/side instructions; generator plate; separate required ENGINE_IDENTIFICATION slot. The two plates cannot satisfy one another. Engine plate is private IDENTITY evidence. |
| LADDER | Missing | Add Workshop/Construction type; STEP/EXTENSION/MULTI_PURPOSE/SCAFFOLD; section×step configuration, max ladder length, distinct optional working height, load/material and optional standard/folded dimensions/weight. Photo guidance covers unfolded/folded/configurations/locks/label. Load/standard require label/document; no guessed safety rating. |
| CONSUMABLE | Missing; mixed into ACCESSORY | Add Parts/Accessories type; TRIMMER_LINE, ABRASIVE_DISC, WIRE_BRUSH, WELDING_ELECTRODE, OIL, GREASE with Annex B's per-subtype required spec fields. WIRE_BRUSH also requires max_rpm per the safety clause. Store repeatPurchase=true as type metadata, no fabricated SKU claim. No fit calculation or reminder feature. |
| SPARE_PART | Broad subsystem enum + required free-form compatible_engine_or_machine | Add controlled part_subtype: CHAIN, GUIDE_BAR, AIR_FILTER, SPARK_PLUG, BELT, TILLER_TINE, with their listed required specs. Keep old fields for history; compatible_engine_or_machine becomes optional, leaves identity/research requirements and creates no fit relationship. |
| ACCESSORY | Named Consumable / Accessory with aliases for line, chain, oil/disc | Correct the generic type name and its generated photo guidance; remove those misleading aliases. Preserve every existing consumable_kind enum value per the owner's follow-up; no existing SKU is moved or rewritten. Gloves/PPE classification remains open. |
| ACCESSORY / POWER_TOOL / FARM_PROCESSOR | Existing controlled vocabularies | Keep keys and values. Add ADMIN-only audited subtype-key/KA/EN-label form. New entries have no required specs until the owner defines them. No invented subtype/spec matrix. |
| Missing full tables | Annex A has only six SPARE_PART examples and two CONSUMABLE examples; no full matrices for the other three | CONSUMABLE uses approved Annex B. The three missing matrices remain explicitly open after first intake. |
| Required-spec metadata | Only flat attribute tiers | Add optional enumValueMetadata in existing JSON, containing labels and requiredSpecFields. Future approved fields/requirements augment an existing subtype through the same command, preserving intake-added values and custom fields. No new two-stage publishing gate. |
| Technical content checks | Unit aliases did not include newly declared fields of the same unit; every kW draft fact could render as HP | Propagate type-specific unit fields to their aliases, keep parameter-label matching, and limit the legacy HP display conversion to universal power_kw. Electrical rated/max output stays in kW. The four accepted checks and unrestricted language policy remain. |
| Evidence/photos | No distinction between absence and deferred capture | Append-only attributed observations: PLATE_ABSENT → NOT_FOUND/null, LATER → PENDING/CAPTURE_PENDING. Accepted facts are preserved; unknown fields get an explicit absence reason. Class A observations stay intake-only until admin resolution. |
| Recommendations / compatibility | Described in source documents | Not implemented: public subcategories, filters/navigation, compatibility/fit_status, engine_models/uses_engine relations, inheritance, two-stage publishing, parts finder or imports. |

CHAIN pitch stays a source string (e.g. fractions); lengths have explicit cm/mm fields; grease's
volume/weight is a source string with its unit. Unknown readings remain unknown. Subtype/spec
requirements are reference/research metadata; ADR-010 remains the identity/READY policy.

## Operations and business setup

1. Create database/roles, migrate and deploy queues using the main runbook.
2. Supply the explicit target DATABASE_URL; run `pnpm ops:reference-data` to preview.
3. Review changes, then `pnpm ops:reference-data --apply --expect-database=<actual-name>`.
   The command is intentionally usable in production: it applies only the reviewed neutral
   reference package, under one audited/outbox transaction. It never calls a seed or creates
   users/entities/stores/pools/SKUs/stock/devices/settings. Re-running unchanged data is a no-op.
4. Bootstrap the first ADMIN interactively; complete TOTP. Use the entities UI to create real
   legal entities and VAT settings; create stores in their UI; use inventory ADMIN controls to
   create owner pools, record relationships and select each storefront's pool. These remain
   explicit audited/idempotent operations with the existing consignment/drain checks.
5. Use products → subtype management for the three owner-authorized editable vocabularies.
   Every entity/subtype write requires persisted recent strong proof. No business value is
   embedded in reference data, an operations command or a development fixture for deployment.

Reference updates preserve stable IDs, disabled state, custom attributes and intake-added enum
values. Approved definitions update reference-owned metadata; the audit retains before/after.
Affected identity projections are recomputed under the normal catalog/SKU locks. READY/slug
history is preserved, with ADR-010 re-verification when needed; no old SKU is automatically
classified into a new type. Operators must review the preview and resulting admin attention.

## Checked plate absence

ENGINE_IDENTIFICATION offers native capture, “ფირფიტა არ აქვს”, or “მოგვიანებით”. Reports use the
existing per-user offline queue and await intake delivery. Checked absence resolves that engine
capture step without creating a photo, including an engine-only PHOTO_REQUEST (its audit names
the observation that resolved it); later remains pending. IDENTIFICATION's explicit absent
plate reason suggests packaging/sticker/marking capture. Review shows the author/time and guides
the administrator to documents/supplier rather than asking for a nonexistent plate again.
Observations are immutable; a later observation is a new row. Real photos and accepted evidence
remain separate. The observation never confirms a value or overrides a VERIFIED/CONFLICT field,
and does not silently choose the product's identity kind or an ADMIN not-determinable decision.
A genuine accepted image clears the outstanding capture indicator without deleting observation
history. Normal review and notification routing separates documentary follow-up from a retake.

Migration 0055 adds the new slot and append-only observations plus explicit field-projection
provenance. Existing migrations remain unchanged. Optional subtype metadata uses existing JSON;
later approved subtype/spec additions need no schema migration.

## Verification

Focused checks passed for reference data and entity/subtype authorization, actual private engine
photos, absence/later, original-intake ownership, Class A resolution, accepted-document
supersession, offline queue ordering, PHOTO_REQUEST completion and non-retake notifications.
The first capture regression exposed an ATTENTION row without a reason after a real image
cleared an observation. The transition now becomes PENDING for other remaining slots;
the database constraint stays in force. The first full run also exposed a formatting-sensitive
ADMIN route assertion and two property-test timeouts during an interrupted overnight run.
The existing ADMIN guard convention is now used on both configuration pages and the subtype
page is included in the architecture test. No assertion or property timeout was relaxed.
The final full run on fresh khidi_h10_acceptance_test passed **644/644 tests in 117 files**
with no skips in 562.42 seconds, including the MinIO integration, both property suites and A–D.
All 55 working and indexed checkout migration hashes matched that database; 0055 also matched
the exact Git blob. Existing migration files 0001–0054 are unchanged.
The five plate-observation tests also passed after correcting a typed upload fixture; there was
no runtime code change after the full run. Repository typecheck, lint, dependency boundaries,
and the production build with temporary synthetic configuration passed.

The dedicated empty reference-command database retained zero users/entities/stores/pools/SKUs.
Its two system-setting defaults came from migrations 0039/0046 and were untouched by the command.
The command installed eight public categories plus the internal fallback and 33 Product Types.
Preview made no writes; repeating the production-mode application made no changes. Neither ran seeds.
The real local recovery drill verified all 55 migration checksums, 99 table counts, 37 object hashes,
25 private references and two raw samples; inventory and A–D passed on a writable clone, while
the recovered original stayed unchanged. Scenario A exercised checked absence through HOUSE_DEFINED
MEDIUM and ADMIN-confirmed READY. See the [sanitized proof](m11-restore-result.json).
