# ADR-010: Evidence-based identity and house-defined products

- **Status:** Accepted
- **Date:** 2026-11-06
- **Decided by:** project owner
- **Supersedes:** errata E2 (manual identity confidence); the M2 READY precondition
  "verified brand and model" (F1) for products without manufacturer identity
- **References:** Specification §5.9–5.10, §6, §15; ADR-005; ADR-007

## Context

Confirmed by the client:

- products often have **no barcode**;
- a manufacturer website almost never exists;
- some products have **neither a model plate nor a passport/manual**.

The client says import documents (invoice, packing list, customs declaration) exist per shipment
and that supplier contacts exist. This is not yet verified in practice, so the design must also
work when no document is available.

The current model assumes identity means "manufacturer X, model Y", proven mainly by the plate.
For a large part of this catalog that cannot be proven. Without a second path, those products
would never reach READY. With a loose path, different variants (e.g. 7 HP and 9 HP) would be
merged or given invented specifications.

## Decision

### 1. Two kinds of identity

`skus.identity_kind`:

- **`MANUFACTURER_IDENTIFIED`** — brand and model are proven by evidence.
- **`HOUSE_DEFINED`** — the product's identity is defined by AgroTrade: Product Type,
  distinguishing attributes, reference photos and anchor evidence. Brand may be unknown
  (`brand = null`) or known without a model. This is a legitimate final state, not an
  unfinished one.

Every new SKU starts as `HOUSE_DEFINED`. Changing the kind is an admin action, audited; it moves
to `MANUFACTURER_IDENTIFIED` only when the brand and model fields are VERIFIED.

### 2. Evidence registry

Every evidence item has a type, a sensitivity, an author, a capture time, optional media, and an
admin status (`PENDING`, `ACCEPTED`, `REJECTED`). Evidence uses `ACCEPTED` so it is never
confused with a field's `VERIFIED` status.

| Type | Typical content | Sensitivity | Strength |
| --- | --- | --- | --- |
| `PRODUCT_PLATE_PHOTO` | Model plate | AI_ALLOWED | Strong |
| `PRODUCT_MARKING_PHOTO` | Engine stamp, sticker, cast marking | AI_ALLOWED | Strong |
| `PASSPORT_MANUAL` | Passport, manual | AI_ALLOWED | Strong |
| `FACTORY_SPEC_SHEET` | Supplier/factory spec sheet | AI_ALLOWED | Strong |
| `SUPPLIER_DOCUMENT` | Invoice, packing list, proforma — as an admin-entered line extract | INTERNAL_ONLY | Strong for what the line explicitly states |
| `MEASUREMENT` with reading photo | Weight, dimensions, measured value + photo of the scale/tape | AI_ALLOWED | Strong for the measured field |
| `ADMIN_PHYSICAL_INSPECTION` | Admin's recorded check of observable facts, with photo or note | INTERNAL_ONLY | Strong for observable facts only (fuel type, wheel type, number of gears visible) |
| `PACKAGING_PHOTO` | Carton/box label | AI_ALLOWED | Medium |
| `CUSTOMS_DECLARATION` | Customs line description | INTERNAL_ONLY | Medium |
| `SUPPLIER_CORRESPONDENCE` | Email/WeChat screenshot | INTERNAL_ONLY | Medium |
| `SUPPLIER_CATALOG` | Supplier catalog page, price list (prices excluded) | INTERNAL_ONLY | Medium |
| `MEASUREMENT` without reading photo | Measured value only | INTERNAL_ONLY | Medium |
| `STAFF_STATEMENT` | "We sell this as 9 HP" — author and role recorded | INTERNAL_ONLY | Weak |
| `PUBLIC_WEB` | Any web page | AI_ALLOWED | Weak |

`INTERNAL_ONLY` evidence is never sent to an AI provider in M5. For supplier documents the admin
enters the relevant line (document number, line text, quantity, stated attributes); the photo or
scan of the document stays in internal storage. A redacted-document path for AI may be added later
only by a new ADR after the client agrees.

### 3. Field verification rule

Only **accepted** evidence counts. An admin accepts an evidence item after checking that it is
authentic, belongs to this SKU, and that the values attributed to it are read correctly.
`PENDING` evidence creates candidate values and reveals conflicts, but never verifies a field.
Each claim records whether it came from a person or from an AI job, with the job ID for
AI readings. At acceptance, the admin explicitly confirms each AI reading to keep it.
The system audits the confirmed fields and drops unchecked AI readings.

A factual field becomes `VERIFIED` only when one of these holds and no contradicting evidence is
unresolved:

- at least one accepted **Strong** item states the value; or
- two accepted **Medium** items of **different types** state the same value; or
- one accepted **Medium** item states the value and an admin explicitly confirms that field
  value (a field-level confirmation, recorded and audited).

**Weak** evidence alone never verifies a field; it stays `UNVERIFIED`. Two evidence items with
different values make the field `CONFLICT`; an admin resolves it by verifying or rejecting
evidence, never by typing a value over it. Unknown remains `NOT_FOUND`. Storefront projections
expose only `VERIFIED` specifications.

### 4. Distinguishing attributes per Product Type

Each Product Type definition gets `distinguishingAttributes`: the fields that separate its
variants (e.g. MOTOBLOCK: fuel type, power, gearbox type, wheel type). Seed them from the
Product Type Matrix; admins can edit them. For a SKU, each distinguishing attribute must end as
`VERIFIED` or be explicitly marked by an admin as "not determinable" (with a reason).

### 5. Identity confidence (deterministic, versioned)

Computed by rule `identity-rule-v1`; the result, the rule version and the contributing evidence
ids are stored. No LLM computes or states confidence. No manual confidence setting exists; the
M2 manual route is retired and its audit history kept.

**`MANUFACTURER_IDENTIFIED`**

- HIGH: brand and model VERIFIED with at least one Strong item, uniqueness check passes and no identity CONFLICT.
- MEDIUM: brand and model VERIFIED only through Medium evidence and uniqueness check passes.
- LOW: otherwise. CONFLICT: identity fields in conflict.

**`HOUSE_DEFINED`**

- HIGH: Product Type set; MAIN and SECONDARY reference photos VERIFIED; at least one **anchor**
  (`SUPPLIER_DOCUMENT`, `CUSTOMS_DECLARATION`, `SUPPLIER_CORRESPONDENCE`, `SUPPLIER_CATALOG`,
  `FACTORY_SPEC_SHEET` or `PASSPORT_MANUAL`) ACCEPTED and linked to this SKU; all distinguishing
  attributes VERIFIED or marked not determinable; uniqueness check passes; no CONFLICT.
- MEDIUM: same as HIGH but without a document anchor, with an `ADMIN_PHYSICAL_INSPECTION`
  instead. This is the path for products with no document at all.
- LOW: otherwise. CONFLICT: any unresolved conflict on distinguishing attributes.

READY requires HIGH, or MEDIUM with an explicit admin confirmation at the READY transition
(recorded as part of that transition, not as a confidence change).

### 6. Variant safety (never merge what cannot be told apart)

- Linking an intake or unit without identifiers to an existing SKU is never automatic. AI photo
  similarity may only propose "possibly the same as SKU X"; an admin decides.
- **Uniqueness check:** this rule applies to both identity kinds. Two non-archived SKUs of the same Product Type are
  *indistinguishable* when, for every distinguishing attribute, their values are equal or at
  least one of them is unknown or "not determinable", and no other VERIFIED difference exists
  (a different VERIFIED brand counts as a difference). Of two indistinguishable SKUs, the second
  cannot become READY until the admin resolves it by one of: merging them (same product);
  adding evidence that verifies a differing distinguishing attribute; or recording an
  `ADMIN_PHYSICAL_INSPECTION` that documents an observable difference. Example: SKU A has
  7 HP VERIFIED, SKU B has unknown power and no other verified difference → B is blocked.
- A distinguishing attribute marked "not determinable" is shown nowhere publicly and is never
  inferred from similar products.

### 7. Naming and slugs for house-defined products

- KA display name: `[Product Type][, brand if verified], [VERIFIED distinguishing attributes]`,
  e.g. `მოტობლოკი, დიზელი, 7 ცხ.ძ.` or `WEIMA მოტობლოკი, დიზელი, 7 ცხ.ძ.`. Never an invented
  model; never the internal `KH-` number.
- The display name may change as attributes become verified. The canonical slug is fixed at
  READY from the English type, verified brand and attributes; on collision the admin adds a short
  distinguishing term; a numeric suffix is the last resort. Later changes go through slug history.

### 8. Evidence capture and missing information (M5 scope)

- PWA evidence capture: `ყუთის ფოტო`, `ნიშნულის ფოტო`, `დოკუმენტის ფოტო` (stored internal-only),
  `გაზომვა` (value, unit, method, optional reading photo).
- `EVIDENCE_REQUEST` task type is implemented in M5.
- "Missing information" view: SKUs lacking an anchor or with undetermined distinguishing
  attributes, filterable by the supplier name recorded on supplier evidence (free text; no
  supplier management), with a CSV export the client can use to request spec sheets from
  suppliers.

##### 9. READY products that no longer satisfy the rule

Applies both to products READY before this ADR and to products approved later when new evidence
creates a conflict:

- the product keeps `READY` and its slug; the actual computed confidence (`LOW` or `CONFLICT`)
  is stored; `reverification_required = true` places it on the re-verification list with an
  ACTION_REQUIRED notification. A new migration allows READY with LOW/CONFLICT only while
  `reverification_required` is true;
- sellability: a field in CONFLICT is never exposed to storefronts; a conflict on an identity
  field (brand/model for `MANUFACTURER_IDENTIFIED`, Product Type or a distinguishing attribute
  for `HOUSE_DEFINED`) makes the product not sellable until resolved; legacy LOW without
  conflict stays sellable while flagged;
- the admin resolves by adding/accepting/rejecting evidence, archiving, or (for identity changes)
  moving the SKU back through the lifecycle. New READY transitions always use this ADR.

## Consequences

- Products without plate, passport or barcode can reach READY honestly, with fewer published
  specifications rather than invented ones.
- Supplier documents become the most valuable anchor; the client's receiving process should
  photograph cartons and documents before packaging is discarded.
- Schema: `identity_kind`, evidence registry tables, `distinguishingAttributes` on Product Types,
  stored confidence results with rule version — all in new migrations.
- The specification §6.1–6.4 and §5.10 will be updated to match this ADR.
