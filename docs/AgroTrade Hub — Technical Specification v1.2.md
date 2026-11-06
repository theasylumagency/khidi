# AgroTrade Hub — Technical Specification v1.2

Nov 1, 2026 · @George

## 0. Document control

v1.2 replaces all earlier versions. It separates payment commitment from physical stock movement, adds storefront listings, extends accounting mapping and reports to seller entities, and adds pre-development SEO tasks. v1.1 had added two legal entities, Hub-owned base prices, manual online stock, fulfillment requests, backups and Hub concealment.

### 0.1 Changes in v1.2

| Area | v1.1 | v1.2 |
| --- | --- | --- |
| Payment vs physical stock | Payment success = SALE, reducing stock immediately | Payment success = COMMITTED: sellable stock drops, physical stock stays. Physical stock leaves only at handover (§10.2, §10.6, §10.7, §11.2). |
| Pool locations | One undifferentiated pool | Each pool has SHELF and STAGING locations; picking moves units SHELF → STAGING (§10.2). |
| Reconciliation | Counted the online shelf against one total | Counts SHELF and STAGING separately against expected per location (§10.11). |
| Accounting mapping | Required for the owner entity | Required for the seller entity, and also for the owner entity when they differ (§5.5, §15.2). |
| Movement reports | Per owner entity | Per legal entity, with owner, seller, storefront and relationship mode on every row; sale date and physical exit date separated (§10.10). |
| Storefront listing | Mentioned, not modelled | Explicit `storefront_listings` object (§4.5). |
| Access gateway | Required, untested against PWA | PWA install, service worker, camera, offline queue and Web Push must be verified behind it (§16.3, §17.3). |
| SEO snapshot | Data model only | Pre-development operational tasks outside the coding scope, starting now (§18.1). |
| Delivery to coding agent | Unspecified | One milestone at a time, human review of migrations and domain tests (§17.4). |

### 0.2 Changes in v1.1 (from v1)

| Area | v1 | v1.1 |
| --- | --- | --- |
| Legal entities | Not modelled | Two sellers: AgroTrade and the new-brand company. Storefront has a seller entity; stock pools have an owner entity (§4). |
| Retail price | Owned by storefronts | Storefront-scoped base price lives in the Hub. Promotions and campaigns stay in storefronts (§9). |
| Orders | Not defined | Orders, customers and payments live in storefronts. The Hub receives anonymous fulfillment requests (§11). |
| Stock source | Implicit | Online stock is entered manually from a dedicated online warehouse in AgroTrade's accounting. The Hub never reads or writes accounting data (§10.1). |
| Accounting sync | Not defined | Daily movement report export, periodic reconciliation counts, replenishment requests (§10.9–10.11). |
| Transfers between storefronts | Always virtual | Virtual only within one owner entity. Cross-entity transfers require a document reference (§10.5). |
| Reservations | Card payment only | Policy per payment method: card, bank installment, cash/pay on pickup (§10.7). |
| Photo validation | Single step | On-device instant checks plus asynchronous server checks (§8.3). |
| UI language | Unspecified | Georgian primary, i18n-ready; warehouse UI Georgian only (§13.5). |
| Backups | Missing | PITR, object versioning, tested restore in Definition of Done (§16.7). |
| Hub concealment | Partial | Server-to-server only; public media served from storefront domains; access gateway (§16.3). |
| Deviation rule | Agent may implement better architecture | Implementation details free; domain semantics require an ADR and approval first (§3.5). |

### 0.3 How to read this document

"Must" is a requirement. "Should" is a strong default that may be changed with a documented reason. Items marked **\[OPEN\]** depend on a business decision listed in §18; build them as configurable, never hard-coded.

## 1. Mission and core principle

Build a production-ready internal **AgroTrade Hub**: the canonical operational source for products, SKUs, evidence, accounting mappings, media, storefront base prices, online stock allocation, reservations, scanning and fulfillment work. It is not a public website. Two independent storefronts on separate domains, run by two legal entities, will consume it.

The Hub answers:

> What is this physical product, what evidence supports its data, who owns the units set aside for online sale, how many units may each storefront sell, at what base price, and what must the warehouse pick and ship?

The storefronts answer:

> How do we present, promote and sell it, and how do we handle the customer, the order and the payment?

### 1.1 The Hub owns

- canonical product identity: Product Family, SKU/Variant, Bundle;
- technical specifications, normalized units, manufacturer, brand, model;
- identifiers, internal SKU, internal QR/Code128 labels;
- accounting mappings (identifiers only, entered manually);
- evidence and provenance;
- raw and processed product media;
- canonical factual KA/EN content and search aliases;
- taxonomy and Product Types;
- legal entities, storefront definitions, storefront listings and entity relationships;
- storefront-scoped base prices and price history;
- stock pools, owner entities, storefront allocations, reservations, stock ledger;
- minimum-stock rules, reconciliation counts, replenishment requests;
- fulfillment requests and their pick/ship status;
- scan, photo, evidence and count tasks;
- AI-assisted identification and content;
- users, roles, notifications, audit history;
- movement reports for the entities' accountants.

### 1.2 Storefronts own

- customers and all customer personal data;
- carts, orders, checkout, payments, bank installments, merchant accounts;
- invoices, fiscal receipts and other customer-facing documents of their seller entity;
- promotional prices, discounts, coupons, campaigns, banners;
- presentation, design, merchandising, category ordering, recommendations;
- storefront-specific editorial copy, SEO titles, meta descriptions, FAQ.

### 1.3 Boundary rules

- The Hub must never store customer names, phones, addresses, emails or payment data.
- Storefronts must never write canonical product facts, stock balances or base prices.
- The effective selling price = Hub base price, adjusted by storefront promotion logic. The storefront reports the final unit price in each fulfillment request for reporting only.
- The Hub never connects to AgroTrade's accounting system. It exchanges data with accounting only through people: manual entry in, report export out.

## 2. Scope of Phase 1

Phase 1 builds the Hub, its backend and its storefront-facing API. No public storefront is built.

### 2.1 In scope

1. Authentication and role-based access.
2. Installable internal PWA, Georgian UI.
3. Legal entities and storefront definitions.
4. Product Master: Product Family, SKU/Variant, Bundle.
5. Product Types and attribute schemas.
6. Identifiers, internal SKU, label printing.
7. Manual accounting-item mapping.
8. Scan Tasks, Admin Quick Scan, no-barcode intake.
9. Guided Photo Intake with two-tier quality validation.
10. Evidence and document management.
11. AI-assisted identity resolution and KA/EN canonical content.
12. Product review and approval workflow.
13. Storefront base prices and price history.
14. Stock pools with owner entities, storefront allocations, transfers.
15. Manual online-stock workflow: entry, reconciliation counts, replenishment requests.
16. Immutable stock ledger.
17. Reservation engine with payment-method policies.
18. Fulfillment requests and warehouse pick/ship flow.
19. Movement reports (CSV/XLSX) per owner entity.
20. Minimum-stock alerts.
21. In-app notifications and Web Push.
22. Audit history.
23. Versioned storefront API with scoped service credentials.
24. Transactional outbox and signed webhooks.
25. Backups and tested restore.

### 2.2 Explicit non-goals

Do not build:

- public storefronts, checkout UI, payment UI, installment UI;
- order or customer management;
- any integration with the accounting system (FMG or other), read or write;
- accounting automation, invoicing, fiscal documents, waybills;
- ERP, procurement, supplier management, warehouse valuation;
- complex BI or analytics dashboards;
- Kafka, Kubernetes, microservices, Elasticsearch.

Prepare clean extension points for these. Do not implement them.

## 3. Technology and engineering rules

Use a modular monolith in a pnpm monorepo. The catalog is hundreds of SKUs, not millions: optimize for correct transactions, fast mobile scanning and asynchronous processing, not scale.

### 3.1 Stack

| Layer | Choice |
| --- | --- |
| Runtime | Node.js 24 LTS, TypeScript |
| App framework | Next.js 16 |
| Database | PostgreSQL 18, Drizzle ORM, node-postgres, Zod |
| Background jobs | pg-boss (no Redis or Kafka without demonstrated need) |
| Media | S3-compatible object storage with versioning, Sharp |
| Barcode decoding | Native BarcodeDetector where available, ZXing (or equivalent) fallback |
| PWA | Service worker, manifest, IndexedDB queue, Web Push (VAPID) |
| Search | PostgreSQL full-text + trigram |
| Deployment | Nginx, Node processes under PM2 or systemd, separate worker process |

Pin exact dependency versions. Use a mature auth library; never implement password cryptography.

### 3.2 Repository

```text
apps/
  hub/            Internal Next.js PWA + storefront API
  worker/         Jobs: AI, media, outbox, reports, notifications

packages/
  db/  domain/  entities/  products/  pricing/  inventory/
  fulfillment/  scanning/  media/  evidence/  ai/
  reports/  notifications/  auth/  shared/  ui/  i18n/

docs/
  adr/            Architecture Decision Records
```

Future storefront apps must use the versioned API only. They must never access PostgreSQL directly.

### 3.3 Domain logic location

Business logic must live in domain services, never in React components or route handlers. This includes reservation, deduction, allocation transfer, price changes, product approval, accounting-mapping validation, SKU identity, fulfillment transitions and notification rules. UI and API layers only call these services.

### 3.4 Engineering rules

- Every state-changing domain operation runs in one database transaction with its ledger, audit and outbox rows.
- Every externally triggered write accepts an idempotency key.
- Money is stored as integer minor units (tetri) with an explicit currency code, never floats.
- Timestamps are stored in UTC and displayed in Asia/Tbilisi.
- Run tests, typecheck, lint and migration checks at the end of each milestone. Keep the app runnable.

### 3.5 Deviation rule (ADR)

You may freely improve implementation details: table names, indexes, component structure, layout, state management, job orchestration, caching, tooling.

You must not change domain semantics on your own. This covers stock rules, reservation policies, ownership, pricing boundaries, lifecycle states, permissions and AI non-invention rules. If you find a better solution there, write an ADR in `docs/adr/` with context, options and recommendation, mark it **Proposed**, and stop that item until it is approved.

## 4. Legal entities, storefronts and ownership

Two legal entities sell through two storefronts: **AgroTrade** (existing domain) and the **new-brand company** (new domain). Goods physically sit in AgroTrade's warehouse. Every unit of online stock must always have a known owner entity.

### 4.1 Legal entity

```text
legal_entities
  id
  key                 e.g. AGROTRADE, NEWBRAND
  legal_name
  tax_id
  active
  created_at
```

The Hub stores entity identity only. It issues no invoices or fiscal documents.

### 4.2 Storefront

```text
storefronts
  id
  key
  name
  domain
  seller_entity_id     → legal_entities
  media_base_url       public image host on the storefront's own domain/CDN
  webhook_url
  active
  created_at
```

A storefront is not a product brand. WEIMA, HIROMIKI and BUFFALO are product brands; storefronts are sales channels.

### 4.3 Stock ownership

Each stock pool has an `owner_entity_id`. A storefront allocation draws only from pools available to that storefront. Ownership determines how transfers are recorded (§10.5).

### 4.4 Commercial relationship mode \[OPEN\]

The accountants of both entities will choose how the new-brand company obtains goods. The Hub must support both modes through configuration, per pair of entities:

| Mode | Owner of NEWBRAND's allocated units | Allocation from AgroTrade to NEWBRAND means |
| --- | --- | --- |
| PURCHASE | NEWBRAND, after transfer | A sale between entities. Requires an invoice/waybill reference. Stock moves to a NEWBRAND-owned pool. |
| CONSIGNMENT | AgroTrade, until sold to a customer | Virtual allocation. Each customer sale is reported per entity for settlement. |

```text
entity_relationships
  id
  from_entity_id
  to_entity_id
  mode                 PURCHASE | CONSIGNMENT
  effective_from
  notes
```

The Hub records the business fact and the document reference. It never decides tax treatment and never generates the documents.

### 4.5 Storefront listings

Whether a SKU is offered on a storefront is an explicit admin decision, independent of price and stock. A SKU may have a price and allocated stock and still not be listed on Storefront A.

```text
storefront_listings
  id
  storefront_id
  sku_id
  enabled
  enabled_at
  enabled_by
  disabled_at
  disabled_by
  reason
```

One row per storefront and SKU. Changes are audited and emit `LISTING_CHANGED` through the outbox.

## 5. Product model

The catalog is rebuilt clean-room from physical and documentary evidence. Legacy content is never canonical truth.

### 5.1 Hierarchy

```text
Product Family     conceptual model, e.g. HIROMIKI 178FE
  └─ SKU/Variant   independently stockable configuration
       └─ Storefront allocation + base price (per storefront)
```

Separate SKUs are required when configurations differ in physical build, stock, accounting item, barcode or sellable identity. Example: 9 HP with rubber wheels and 9 HP with iron wheels are two SKUs. Never merge physically different variants because their marketing names are similar.

### 5.2 Bundles

A bundle is not a variant.

- **Composed bundle**: independently stockable components, e.g. motoblock × 1 + plough × 1 + trailer × 1. Availability derives from component availability; a sale consumes component stock.
- **Factory kit**: a kit the accounting system treats as one item. Model it as a normal SKU with `is_kit = true` and an informational component list.

### 5.3 Identifiers

```text
sku_identifiers
  id
  sku_id
  identifier_type    GTIN | UPC | MPN | FACTORY_MODEL | PLATE_VALUE |
                     SUPPLIER_CODE | ACCOUNTING_CODE | INTERNAL_SKU |
                     INTERNAL_QR | LEGACY_ALIAS
  value
  issuer_source
  verified
  is_primary
  created_at
```

Do not assume values are globally unique unless the type guarantees it. Collisions create a review item, never a silent merge.

### 5.4 Internal SKU and labels

Every SKU receives a stable, entity-neutral internal ID starting from 1, e.g. `KH-000001`. Never use a name as identity. Never invent a GTIN/EAN.

When no usable barcode exists: create a provisional intake, identify the product, assign the internal SKU, generate a QR and Code128 label, print it, and attach it to the product, shelf or location. Later scans of that label resolve directly to the SKU. Label printing must support common thermal label printers via browser print with a fixed label template (default 58 × 40 mm, configurable).

### 5.5 Accounting mapping

Mapping is entered manually by an admin. It is mandatory before SELLABLE, not before intake.

```text
accounting_mappings
  id
  sku_id
  owner_entity_id
  accounting_item_id     opaque string, e.g. 1610/00004/0009
  accounting_name        preserved exactly as entered
  legacy_code            optional
  active
  notes
```

One SKU may map to several accounting records, possibly in different entities. Never parse the identifier's structure. To be SELLABLE on a storefront, a SKU needs an active mapping for that storefront's seller entity, which issues the customer-facing documents. When the owner entity of the allocated stock differs from the seller (CONSIGNMENT), an active mapping for the owner entity is required too.

### 5.6 Units

Store normalized numeric values with the original source string.

```text
power_kw, engine_displacement_cm3, length_mm, width_mm, height_mm,
working_width_mm, working_depth_mm, weight_kg, volume_l,
pressure_bar, flow_l_min, voltage_v, current_a

source_value = "9 HP"  →  power_kw = 6.62
```

Presentation converts for display. Never use display strings as canonical values.

### 5.7 Taxonomy

There is no public "Miscellaneous / სხვადასხვა" category. Unknown items get internal status `UNCLASSIFIED` and require review.

| Top-level category (EN) | KA |
| --- | --- |
| Agricultural machinery | სასოფლო-სამეურნეო ტექნიკა |
| Garden & forestry | ბაღისა და ტყის ტექნიკა |
| Spraying & irrigation | შესხურება და სარწყავი |
| Farm equipment | ფერმის დანადგარები |
| Workshop & construction | სახელოსნო და სამშენებლო |
| ATV & transport | კვადროციკლები და ტრანსპორტი |
| Tires & wheels | საბურავები და ბორბლები |
| Spare parts & accessories | სათადარიგო ნაწილები და აქსესუარები |

Product Type matters more than category.

### 5.8 Product Types

Initial set:

```text
MOTOBLOCK  EARTH_AUGER  AGRI_ATTACHMENT  TRAILER
BRUSHCUTTER  LAWN_MOWER  CHAINSAW  SHREDDER  BLOWER
SPRAYER  WATER_PUMP  IRRIGATION_ACCESSORY
FEED_MILL  MILKING_MACHINE  FARM_PROCESSOR
POWER_TOOL  WELDER  COMPRESSOR  CONCRETE_MIXER  JACK  WHEELBARROW  HAND_TOOL
ATV  TRICYCLE
TIRE  TUBE  WHEEL_RIM
ENGINE  SPARE_PART  ACCESSORY
```

Adding a type must not require a database redesign. Each type defines: required identity fields, important and optional specifications, filter candidates, photo instructions, naming template, AI research contract. The Product Type Matrix v1 is the seed for these definitions.

### 5.9 Attributes

Use a hybrid model: typed columns for universal data, schema-driven type attributes in JSONB validated against the Product Type schema (Zod). No uncontrolled JSON blobs. Each attribute value carries status (`VERIFIED`, `UNVERIFIED`, `NOT_FOUND`, `CONFLICT`) and provenance (§6.3).

### 5.10 Naming engine

Names are generated deterministically from verified structured data, never as free AI copy.

```text
[Brand] [Model] — [Product Type], [Key differentiator]
HIROMIKI D178E-DF900Q — მოტობლოკი, 9 ცხ.ძ.
HIROMIKI D178E-DF900Q — Motoblock, 9 HP
```

Unknown differentiator → omit it. Never invent. Public KA term is "მოტობლოკი"; "კულტივატორი" and similar historic terms remain search aliases. Accounting names are preserved unchanged.

The example above applies to manufacturer-identified products. For house-defined products use the Product Type, an optional verified brand, and verified distinguishing attributes. The name can change when evidence changes. See [ADR-010](adr/ADR-010-evidence-identity-and-house-defined-products.md).

### 5.11 Canonical slug

Each SKU gets a stable ASCII `canonical_slug`, e.g. `hiromiki-d178e-df900q`. It does not change when the display name changes. If it ever changes, the old slug is kept in slug history for redirects.

For a house-defined product, derive the initial slug from its English Product Type and verified brand and distinguishing attributes. On collision, ask the administrator for a distinguishing term before offering a numeric suffix. See [ADR-010](adr/ADR-010-evidence-identity-and-house-defined-products.md).

### 5.12 Canonical content

Per SKU, in KA and EN: display name, short description, full factual description, search aliases. This is factual reference content. Storefronts build their own editorial copy on top (§12.4).

## 6. Evidence, identity and AI

Identity is resolved from evidence, not from the internet. For this market an official manufacturer page often does not exist; public web data is supporting evidence only.

### 6.1 Evidence priority

The evidence type determines its strength and sensitivity. A source supports only the facts it establishes. Physical inspection supports observable facts. Public web evidence is Weak. See the [ADR-010 evidence type matrix](adr/ADR-010-evidence-identity-and-house-defined-products.md#2-evidence-registry).

### 6.2 Evidence items

Each evidence item belongs to a SKU and records its type, sensitivity, author, capture time, optional media, candidate readings and administrative decision. Evidence starts as `PENDING` and an admin may mark it `ACCEPTED` or `REJECTED`. Supplier document images and their line extracts stay internal and are visible to ADMIN only.

### 6.3 Field provenance

Every factual field links to its source evidence and has status `NOT_FOUND`, `UNVERIFIED`, `VERIFIED` or `CONFLICT`. Pending evidence can propose candidates and reveal a disagreement. When there is no unresolved contradiction, one accepted Strong item, two accepted Medium items of different types, or one accepted Medium item plus an explicit audited field confirmation verifies the reading. The storefront projection includes only verified facts.

### 6.4 Identity confidence

Confidence is computed under [ADR-010](adr/ADR-010-evidence-identity-and-house-defined-products.md). Manufacturer-identified products require verified brand and model. House-defined products require a Product Type, verified reference photos, distinguishing attributes verified or marked not determinable, and a uniqueness check. An accepted document anchor supports HIGH; an accepted administrative physical inspection supports MEDIUM without a document. MEDIUM requires explicit admin confirmation at READY. Existing READY products retain their slug if confidence drops to LOW or CONFLICT and enter the re-verification list. An identity conflict blocks sellability.

### 6.5 AI may

Classify Product Type; extract brand, model and specs from evidence; normalize units; propose titles via the naming engine; generate KA/EN factual descriptions and search aliases; detect contradictions; propose image candidates; summarize for review.

### 6.6 AI must never

- invent missing specifications, manufacturers, model identity or GTINs;
- silently resolve contradictory sources;
- let public web data override stronger physical or importer evidence (mark `CONFLICT` instead);
- modify product geometry, parts, logos or colour in images.

Unknown is a valid state: `value: null, status: NOT_FOUND`.

### 6.7 Research contracts

Each Product Type defines which fields AI must find and verify. Example MOTOBLOCK: engine model, fuel type, power, displacement, start type, gearbox, gears, working width, working depth, wheel size, weight, included equipment. AI researches only the contract fields.

### 6.8 AI jobs

All AI work runs in background jobs: `identify-product`, `extract-evidence`, `ocr-label`, `normalize-specifications`, `classify-product`, `generate-canonical-content`, `analyze-photo-quality`, `process-images`.

Requirements: retries with backoff, idempotency, visible job status, dead-letter queue, admin retry action. Scanning never waits for AI. The Hub stays fully usable for manual work when AI is unavailable.

Provider and model are configuration behind one internal interface. Record provider, model, prompt version, token usage and monetary cost per attempt. Reserve the daily budget before provider execution, using Asia/Tbilisi calendar days. Provider input is limited to processed, metadata-free masters or derivatives and approved research fields. Raw images, invoices, packing lists, prices and `INTERNAL_ONLY` evidence stay internal. M5 uses local synthetic fixtures.

## 7. Scanning and intake

Scanning is the gateway from the physical warehouse into the Product Master. It must be fast, mechanical and never blocked by AI or network.

### 7.1 Admin Quick Scan

```text
Quick Scan → camera → scan identifier (or "No barcode")
→ identifier accepted → optional photos → intake created
→ background processing
```

Admin may skip photos.

### 7.2 Task types

Admin creates tasks and assigns them to a user or role.

| Task type | Purpose | Repeated scan of same identifier |
| --- | --- | --- |
| INTAKE\_UNIQUE | Register product models with photos | Detected as duplicate, no new product |
| PHYSICAL\_COUNT | Count units in a zone (e.g. online shelf) | Increments count |
| PHOTO\_REQUEST | Retake or add a specific photo for a SKU | — |
| EVIDENCE\_REQUEST | Photograph packaging, manual or document | — |
| PICK | Pick units for a fulfillment request (§11) | Confirms one unit |

Task configuration includes: mode, assignee, Product Type filter (optional), photos required yes/no, due date.

### 7.3 Warehouse scan UX

```text
დავალება: მოტობლოკები
12 / 27 დასრულებულია
[ შემდეგი პროდუქტის სკანირება ]
```

After a scan: "✓ კოდი მიღებულია", then straight into required photos, then the next product. No waiting for identification.

### 7.4 Barcode scanning

- Camera scanning in the PWA; BarcodeDetector where available, ZXing fallback always available.
- Formats: EAN-8/13, UPC-A/E, QR, Code128, Code39, DataMatrix where practical.
- Manual identifier entry always possible.
- Torch toggle and tap-to-focus where the device supports them.

### 7.5 No-barcode flow

A first-class workflow, not an error:

```text
"No barcode" → provisional intake → guided photos
→ identification → internal SKU assigned → QR/Code128 label printed
→ label attached → task item completed
```

Until the label is printed, the intake shows in a "Labels to print" queue.

### 7.6 Intake record

```text
PRODUCT INTAKE
  source:     task_id | quick_scan, user, device, timestamp, idempotency_key
  identity:   scanned identifiers[], accounting record (optional), existing SKU (optional)
  photos:     main, secondary, identification, extra[]
  processing: barcode validation, photo quality, identification, evidence extraction,
              image enhancement, attribute extraction, content generation
  result:     MATCHED_EXISTING | NEW_DRAFT | MANUAL_IDENTIFICATION_REQUIRED
```

## 8. Photo intake and media

Consistent source photos beat synthetic repair. The software optimizes for consistent capture and never reconstructs what the camera did not see.

### 8.1 Required photos

| Slot | Purpose | Instruction |
| --- | --- | --- |
| 1 — Main | Candidate catalog image | Whole product in frame, no cropped edges, minimal unrelated objects |
| 2 — Secondary | Gallery + visual identification | Side or \~45° view |
| 3 — Identification | Evidence, usually not public | Product-Type specific: model plate, engine plate, tire sidewall marking, part number, packaging, technical sticker |

Instructions come from the Product Type definition. A camera overlay frame shows where to place the product. AI may later request an extra photo (e.g. engine plate to distinguish 7 HP vs 9 HP); this creates a PHOTO\_REQUEST task item, not a full re-intake.

### 8.2 Photo station

AgroTrade is expected to set up a simple photo corner: light neutral background, two LED panels, marked product position, marked camera positions. The software must still work with imperfect photos.

### 8.3 Two-tier quality validation

| Tier | Where | When | Checks | On failure |
| --- | --- | --- | --- | --- |
| 1 — Instant | On device, offline-capable | Before accepting the shot | Blur (e.g. Laplacian variance), severe under/over-exposure, minimum resolution | "⚠ ფოტო ბუნდოვანია, გადაიღეთ თავიდან" |
| 2 — Deep | Server, async | After upload | Product fully in frame, label readable (OCR), product consistency across photos | PHOTO\_REQUEST task item to warehouse + admin notification |

Warehouse sees only accepted/retake messages. Admin sees scores and reasons.

### 8.4 Media pipeline

```text
RAW ORIGINAL (immutable)
  → ENHANCED MASTER (versioned: v1, v2…)
  → WEB DERIVATIVES (400, 800, 1600 px; WebP + AVIF)
```

Never overwrite a raw original. Better processing later regenerates from raw. Logical storage paths:

```text
/products/{sku}/raw/      private
/products/{sku}/master/   private
/products/{sku}/web/      published to storefront media hosts (§16.3)
/evidence/{id}/           private
```

The database stores metadata only. Strip EXIF location data from every non-raw file.

### 8.5 Allowed processing

Allowed: exposure, white balance, deterministic crop, perspective correction, noise reduction, modest sharpening, background cleanup, canvas normalization (1:1, neutral light background, centred, consistent padding), resizing, format conversion.

Forbidden: adding or removing parts, replacing wheels, altering logos or colour, reconstructing hidden geometry, inventing accessories. Insufficient source → `NEEDS_BETTER_SOURCE` and a reshoot request.

### 8.6 Image sources and status

```text
product_images
  source_type    WAREHOUSE | MANUFACTURER | LEGACY_SITE
  source_url
  role           MAIN | GALLERY | IDENTITY
  status         VERIFIED | UNVERIFIED | REJECTED
  usage          PUBLIC | INTERNAL_EVIDENCE
```

Legacy-site images may be imported as `UNVERIFIED` references only. The Products workspace offers a "Needs better photos" queue.

## 9. Pricing

The Hub owns one base price per SKU per storefront. Promotions stay in storefronts. One admin manages price and stock for both storefronts in one place.

### 9.1 Base price

```text
storefront_prices
  id
  storefront_id
  sku_id
  base_price_minor     integer, tetri
  currency             GEL
  vat_included         boolean
  valid_from
  set_by
  reason
```

- Price changes append a new row; the current price is the latest valid row. History is never overwritten.
- A SKU cannot become sellable on a storefront without a current base price there.
- Bulk edit: table view with inline editing, CSV import/export, preview of changes before commit.
- Large changes require a confirmation: e.g. a change above 30% (configurable) asks for a reason.

### 9.2 Storefront responsibilities

Storefronts apply promotions, discounts, coupons and installment pricing on top of the base price. They must not write base prices. They report the final unit price in each fulfillment request (§11).

### 9.3 Events

Price changes emit `PRICE_CHANGED` via the outbox so storefronts can refresh caches and feeds (e.g. Google Merchant).

## 10. Inventory

The Hub manages only stock that AgroTrade has explicitly set aside for online sale. It never sees the rest of the warehouse and never assumes: `missing != zero`.

### 10.1 Operating model (no accounting access)

AgroTrade does not give the Hub access to accounting data. The agreed operating model:

1. AgroTrade creates a dedicated **online warehouse/location** in its own accounting system and moves units set aside for online sale there by internal transfer.
2. Those units are physically kept on a marked **online shelf/zone**, so offline sales cannot take them.
3. An authorized AgroTrade user enters the same quantities into the Hub manually (§10.4).
4. The Hub exports daily movement reports (§10.10); the accountant books sales and returns in the accounting system from them.
5. Periodic counts (§10.11) reconcile the Hub with the physical shelf.

The Hub must document this model on its Settings screen. Steps 1, 2 and 4 are AgroTrade's operational responsibility; the Hub enables them.

### 10.2 Concepts

```text
stock_pools
  id
  owner_entity_id      → legal_entities
  name                 e.g. "AgroTrade online shelf"
  location_note

pool_locations
  id
  pool_id
  kind                 SHELF | STAGING
  name

allocations
  id
  pool_id
  storefront_id
  sku_id
  minimum_stock
```

A pool holds units owned by one entity, in two physical locations: SHELF (the marked online shelf) and STAGING (picked units waiting for handover). Allocations assign pool units to storefronts. A pool may also hold unallocated units (buffer). Payment never moves physical stock; only picking and handover do.

```text
on_hand(pool, location) = Σ physical ledger movements for pool + location + sku
pool_on_hand            = on_hand(SHELF) + on_hand(STAGING)
unallocated             = pool_on_hand − Σ allocated

allocated               = Σ allocation movements for the allocation
                          (units assigned to the storefront and still in the pool)
reserved                = Σ active reservations on the allocation
committed               = Σ committed units not yet handed over
available_to_sell       = allocated − reserved − committed
```

A committed unit stays in `allocated` and in `pool_on_hand` until handover; at handover both decrease by one and the commitment closes. The implementation must make double subtraction impossible: define every quantity from ledger movements in one place in the domain layer and test it exhaustively.

### 10.3 Independence

Selling on Storefront A never changes Storefront B's allocation. Each allocation is independently sellable.

### 10.4 Manual stock entry

| Action | Effect | Required |
| --- | --- | --- |
| Receive into pool | pool\_on\_hand +n (STOCK\_IN) | Quantity, optional accounting document reference |
| Allocate | unallocated −n, allocation +n | Quantity |
| Deallocate | allocation −n, unallocated +n | Quantity, cannot exceed available\_to\_sell |
| Return to main warehouse | pool\_on\_hand −n (STOCK\_OUT) | Quantity, reason |
| Write-off | pool\_on\_hand −n (WRITE\_OFF) | Quantity, reason |
| Adjustment | correction after count | Quantity delta, reason |

Each entry shows a confirmation summary before commit and supports an optional external document number.

### 10.5 Transfers between storefronts

| Same owner entity | Different owner entities |
| --- | --- |
| Virtual reallocation: allocation A −n, allocation B +n. Ledger + audit only. | Depends on relationship mode (§4.4). PURCHASE: moves units to the receiving entity's pool and requires an external document reference (invoice/waybill number). CONSIGNMENT: virtual reallocation, the owner stays the same, flagged in reports. |

The UI must make cross-entity transfers visibly different and must block them without a document reference when the mode requires one.

### 10.6 Ledger

The ledger is immutable and authoritative. Balances may be materialized for speed but are always rebuildable from it.

Movement types:

```text
Physical     STOCK_IN  STOCK_OUT  WRITE_OFF  ADJUSTMENT
             PICK_TO_STAGING  RETURN_TO_SHELF  HANDOVER_OUT
Allocation   ALLOCATE  DEALLOCATE  TRANSFER_OUT  TRANSFER_IN   (cross_entity flag + document ref)
Commitment   RESERVE  RESERVATION_RELEASE  COMMIT  COMMIT_RELEASE
Returns      RETURN_RESTOCK  MANUAL_RESTORE
```

There is no single SALE movement: the commercial sale is COMMIT, the physical exit is HANDOVER\_OUT. Each movement records: sku, pool, location (for physical movements), allocation (if any), quantity, owner\_entity\_id, seller\_entity\_id, storefront\_id, relationship\_mode, actor, reason, external document ref, reservation/fulfillment id, correlation id, timestamp.

### 10.7 Reservations

Reservation must be atomic and race-safe using PostgreSQL transactions and row locks (`SELECT … FOR UPDATE` on the allocation balance row). Two customers must never buy the last unit.

Reservation policy is per payment method, configured per storefront:

| Payment method | Reserve when | Default timeout | Commit when | Release when |
| --- | --- | --- | --- | --- |
| CARD | Payment initiated | 30 min | Payment success | Failure or timeout |
| BANK\_INSTALLMENT | Application submitted | 72 h | Bank approval + order confirmed | Rejection or timeout |
| PAY\_ON\_PICKUP / CASH\_ON\_DELIVERY | Order confirmed by storefront | 72 h | At handover, together with HANDOVER\_OUT | Cancellation or timeout |

Unit flow for every sale:

```text
ALLOCATED → RESERVED → COMMITTED → PICKED (SHELF → STAGING) → HANDED_OVER (leaves pool)
```

- RESERVED and COMMITTED reduce `available_to_sell`. Neither changes physical stock.
- PICKED moves the unit from SHELF to STAGING inside the same pool (PICK\_TO\_STAGING).
- HANDED\_OVER removes the unit from STAGING, the pool and the allocation (HANDOVER\_OUT); the commitment closes.
- Cancel while RESERVED: RESERVATION\_RELEASE. Cancel while COMMITTED and not picked: COMMIT\_RELEASE; the unit is sellable again.
- Cancel after PICKED: the warehouse must confirm RETURN\_TO\_SHELF before COMMIT\_RELEASE.
- Order created without a payment step: no stock effect.
- Timeouts are configurable; extending a reservation is an explicit API call. Commitments do not time out.
- Customer return after delivery: no automatic effect; admin records RETURN\_RESTOCK after inspection.
- Composed bundles reserve and commit all components atomically or none.

### 10.8 Minimum stock

Per allocation. Alerts are based on available\_to\_sell.

```text
NORMAL → LOW_STOCK → OUT_OF_STOCK → NORMAL (after restock)
```

One alert per transition, never one per decrement.

### 10.9 Replenishment requests

On LOW\_STOCK or OUT\_OF\_STOCK, the Hub creates a replenishment request addressed to the owner entity's stock manager (role + named users): SKU, storefront, available, minimum, suggested quantity. Statuses: OPEN → ACKNOWLEDGED → FULFILLED | DECLINED. Fulfilment is recorded as STOCK\_IN + ALLOCATE.

### 10.10 Movement reports

Reports are exported per legal entity and date range, in CSV and XLSX, with Georgian column headers. Every row carries `owner_entity`, `seller_entity`, `storefront`, `relationship_mode`, so each entity's accountant gets the correct view in both PURCHASE and CONSIGNMENT.

- **Row fields:** movement type, internal SKU, accounting item id and name for the relevant entity, quantity, storefront, unit price reported by storefront, storefront order reference, document reference, actor, **sale date** (COMMIT), **physical exit date** (HANDOVER\_OUT).
- **As seller:** units the entity sold through its storefront, committed and handed over, with open commitments listed separately.
- **As owner:** units that left the entity's stock, including units sold by the other entity under CONSIGNMENT, for settlement.
- **Transfers:** cross-entity transfers with document references, from both sides.
- **Totals:** sales per storefront, returns, write-offs, adjustments.

A scheduled daily report is emailed or made available for download to configured users of each entity. Reports never contain customer data.

### 10.11 Reconciliation

Admin schedules PHYSICAL\_COUNT tasks for the online pool (default weekly). SHELF and STAGING are counted separately. The Hub shows expected vs counted per SKU and location, so paid-but-not-picked units (on SHELF) and picked-but-not-handed-over units (in STAGING) never appear as discrepancies. Admin approves differences as ADJUSTMENT movements with a reason. Unexplained differences above a configurable threshold create an ACTION\_REQUIRED notification.

## 11. Fulfillment requests

Orders live in storefronts; the physical work lives in the Hub. One warehouse gets one pick list for both storefronts, without any customer data.

### 11.1 Fulfillment request

Created by the storefront via API when a reservation is committed, or when a pay-on-pickup/COD order is confirmed (its reservation commits at handover).

```text
fulfillment_requests
  id
  storefront_id
  storefront_order_ref     opaque string from storefront
  lines[]                  sku_id, quantity, reservation_id, final_unit_price_minor
  delivery_method          PICKUP | COURIER | OTHER
  ship_by                  date
  internal_note            storefront-provided, must not contain personal data
  status
  created_at
```

### 11.2 Status flow

```text
REQUESTED → PICKING → PICKED → HANDED_OVER
    └─────────────────────────→ CANCELLED (any time before HANDED_OVER)

Stock effect:  REQUESTED/PICKING  none (unit already COMMITTED or RESERVED)
               PICKED             PICK_TO_STAGING   SHELF → STAGING
               HANDED_OVER        HANDOVER_OUT      leaves pool and allocation
```

- PICKING: a warehouse user opens the PICK task and scans each unit's identifier to confirm the right SKU.
- PICKED: all lines confirmed and moved to the staging zone. The packing label shows storefront key + order ref, nothing else.
- HANDED\_OVER: given to the courier or customer. For PAY\_ON\_PICKUP/COD, COMMIT and HANDOVER\_OUT are recorded together.
- CANCELLED before PICKED: COMMIT\_RELEASE or RESERVATION\_RELEASE per §10.7.
- CANCELLED after PICKED: the request shows "return to shelf" in the warehouse queue; RETURN\_TO\_SHELF must be confirmed by scan before the commitment is released.

Each transition emits a signed webhook to the storefront (`FULFILLMENT_STATUS_CHANGED`). The storefront owns customer notification.

### 11.3 Warehouse view

One combined queue ordered by ship-by date, filterable by storefront. Each card: storefront, order ref, lines with photo and shelf/location note, ship-by. Wrong-SKU scan shows an immediate error.

### 11.4 Data rule

The API rejects fulfillment payloads containing fields outside the schema. Storefronts must not send names, phone numbers, addresses or emails. Delivery address labels are produced by the storefront or courier system, not the Hub.

## 12. Storefront integration

Storefronts talk to the Hub only server-to-server through a versioned API with credentials scoped to one storefront. A storefront can read and act only on its own allocations, prices, reservations and fulfillment requests.

### 12.1 API v1

```text
GET  /api/v1/storefront/{store}/products?updated_since=…
GET  /api/v1/storefront/{store}/products/{sku}
GET  /api/v1/storefront/{store}/prices?updated_since=…
GET  /api/v1/storefront/{store}/stock/{sku}
GET  /api/v1/storefront/{store}/stock?updated_since=…

POST /api/v1/storefront/{store}/reservations
POST /api/v1/storefront/{store}/reservations/{id}/extend
POST /api/v1/storefront/{store}/reservations/{id}/commit
POST /api/v1/storefront/{store}/reservations/{id}/release

POST /api/v1/storefront/{store}/fulfillment-requests
GET  /api/v1/storefront/{store}/fulfillment-requests/{id}
POST /api/v1/storefront/{store}/fulfillment-requests/{id}/cancel
```

- Product payloads contain canonical facts, base price, availability and public media URLs on the storefront's own media host.
- Every POST requires an `Idempotency-Key` header.
- Credentials: per-storefront service keys, hashed at rest, rotatable, optionally IP-restricted.
- Generate an OpenAPI document from the Zod schemas.

### 12.2 Outbox and webhooks

Important domain events are written to a transactional outbox in the same transaction as the change. The worker delivers them.

```text
PRODUCT_APPROVED  PRODUCT_UPDATED  PRODUCT_ARCHIVED
PRICE_CHANGED  STOCK_CHANGED  STOCK_LOW  STOCK_OUT
RESERVATION_CREATED  RESERVATION_EXPIRED  STOCK_COMMITTED  COMMIT_RELEASED  LISTING_CHANGED
FULFILLMENT_STATUS_CHANGED
SCAN_TASK_CREATED  SCAN_TASK_COMPLETED  PRODUCT_REVIEW_REQUIRED
```

Webhooks are HMAC-signed with a timestamp, retried with exponential backoff, and logged per delivery. Storefronts deduplicate by event id. No fire-and-forget side effects in request handlers.

### 12.3 Media delivery

Published web derivatives are copied or proxied to each storefront's `media_base_url` (its own domain or CDN). Public pages must never reference a Hub hostname.

### 12.4 Content separation

The Hub supplies facts. Storefronts must be able to build their own short and long copy, SEO title, meta description, FAQ and internal links, so two domains do not publish identical text. Specifications may stay identical.

### 12.5 Legacy SEO support

The public migration is not in Phase 1, but the data model is prepared now.

```text
legacy_urls
  id
  old_host
  old_path_raw          as found
  old_path_normalized   decoded, lowercased where safe, trailing slash normalized
  entity_type           PRODUCT | CATEGORY | OTHER
  entity_id
  decision              KEEP_301 | ARCHIVE_PAGE | GONE_410 | UNDECIDED
  gsc_clicks_16m
  gsc_impressions_16m
  backlinks
  notes
```

Rules for the future storefront: new URLs use consistent ASCII slugs; each legacy URL gets a 301 to its exact canonical successor or a 410; mass redirects to the homepage or shop page are forbidden. Redirect matching must handle percent-encoded and decoded Georgian paths and trailing-slash variants. Redirects stay within the AgroTrade domain; the new-brand domain inherits none.

## 13. Users, roles, PWA and UI

Roles are enforced server-side. Users may belong to one or both legal entities; entity membership limits what stock, reports and replenishment requests they see.

### 13.1 Roles

| Role | Can | Cannot |
| --- | --- | --- |
| ADMIN | Everything: users, entities, storefronts, approvals, conflicts, accounting mappings, prices, stock, transfers, reports, audit, evidence including invoices | — |
| OPERATOR | Products, AI drafts, allowed fields, tasks, notifications, stock actions within granted permissions | Users, entities, cross-entity transfers, price changes unless granted |
| STOCK\_MANAGER | Manual stock entry, allocations, replenishment requests, counts, reports for own entity | Product approval, other entity's stock |
| WAREHOUSE | Assigned tasks: scan, photos, evidence, counts, picking | Prices, reports, commercial data, admin screens |
| ORDER\_MANAGER | Fulfillment queue overview, cancellations per storefront | Product and stock administration |

Granular permissions (e.g. `price.edit`, `stock.transfer.cross_entity`) sit under roles so admins can grant exceptions.

### 13.2 Authentication

- Office users: email + password with mandatory TOTP for ADMIN and STOCK\_MANAGER.
- Warehouse users on shared phones: personal PIN on a registered device, short session, quick user switch.
- Device registration and revocation by ADMIN.

### 13.3 PWA

Installable on Android and iOS. Desktop: dense, table-first, keyboard-friendly. Mobile: scanning, tasks, photos, counts, picking, stock actions, notifications. No decorative dashboards.

### 13.4 Navigation

```text
პროდუქტები · მარაგი · ფასები · დავალებები · მიწოდება · შეტყობინებები · ისტორია · პარამეტრები
```

Admin additionally: მტკიცებულებები, მომხმარებლები, იურიდიული პირები, მაღაზიები, ანგარიშები.

### 13.5 Language

- UI language: Georgian primary. All strings go through i18n from day one; English is a secondary locale for admins.
- Warehouse UI: Georgian only, short sentences, large touch targets.
- Code, database identifiers, API and logs: English.
- Georgian typography: use a font with full Mkhedruli coverage; test long Georgian strings in buttons and table headers.

### 13.6 UI style

Clean, dense but readable, neutral, minimal animation, clear status hierarchy. Desktop-first for administration, mobile-first for warehouse work. Usability over visual effects.

## 14. Notifications

Every notification leads directly to the work it is about, with one deep-link action. Delivery: in-app notification center with unread state, plus Web Push where the user enabled it.

### 14.1 Phase 1 events

| Event | Level | Recipients | Action |
| --- | --- | --- | --- |
| NEW\_PRODUCT\_SCANNED | INFO | Admin, operators | Open intake |
| PRODUCT\_REVIEW\_REQUIRED | ACTION\_REQUIRED | Admin, operators | Review product |
| IDENTIFICATION\_FAILED | ACTION\_REQUIRED | Admin | Request photo / evidence |
| PHOTO\_RETAKE\_REQUIRED | ACTION\_REQUIRED | Assigned warehouse user | Open photo task |
| SCAN\_TASK\_CREATED / COMPLETED | INFO | Assignee / creator | Open task |
| STOCK\_LOW / STOCK\_OUT | ACTION\_REQUIRED | Owner entity's stock managers, admin | Open replenishment request |
| REPLENISHMENT\_REQUESTED | ACTION\_REQUIRED | Owner entity's stock managers | Acknowledge / fulfil |
| COUNT\_DIFFERENCE | ACTION\_REQUIRED | Admin | Review count |
| FULFILLMENT\_REQUESTED | ACTION\_REQUIRED | Warehouse | Open pick task |
| FULFILLMENT\_OVERDUE | CRITICAL | Warehouse, order manager, admin | Open request |
| RESERVATION\_EXPIRING (installment) | INFO | Order manager | Open reservation |
| JOB\_FAILED (dead letter) | CRITICAL | Admin | Retry job |
| DAILY\_REPORT\_READY | INFO | Entity accountants (configured) | Download report |

Future (storefront phase): PAYMENT\_SUCCESS, PAYMENT\_FAILED, NEW\_SALE, ORDER\_PROBLEM.

### 14.2 Rules

- Example: "მარაგი იწურება · HIROMIKI D178E-DF900Q — 2 დარჩა · \[შევსების მოთხოვნა\]".
- No repeated alerts for an unchanged state.
- Users can mute INFO per type; ACTION\_REQUIRED and CRITICAL cannot be muted.
- Push payloads contain no prices or customer data.

## 15. Product lifecycle and workspace

A SKU's readiness is an explicit state machine, never a single `published` boolean. Sellability is decided per storefront.

### 15.1 SKU lifecycle

```text
INTAKE → IDENTIFYING → IDENTIFICATION_REQUIRED ⇄ IDENTIFIED
→ ACCOUNTING_MAPPING_REQUIRED → CONTENT_GENERATING → CONTENT_REVIEW
→ READY → ARCHIVED
```

READY means approved canonical identity, accounting mapping and content.

### 15.2 Per-storefront sellability

A SKU is **SELLABLE on storefront X** when all hold:

- SKU state is READY;
- active accounting mapping exists for the storefront's seller entity, and for the owner entity of the allocated stock when it differs (§5.5);
- current base price exists for X;
- at least one VERIFIED public main image;
- an enabled storefront listing exists (§4.5).

Availability (stock > 0) is separate: a SELLABLE SKU may be out of stock.

### 15.3 Review screen

Shows: candidate identity and confidence, Product Family, SKU/variant, raw and enhanced photos (raw one click away), detected identifiers, evidence with provenance, accounting mapping, Product Type, normalized specs with status, conflicts side by side, KA/EN names and descriptions.

Actions: Approve · Edit · Wrong product · Request photo · Request evidence · Resolve conflict · Map accounting item · Merge into existing SKU · Split into variants.

### 15.4 Products workspace

Default desktop page is a table:

| Column | Content |
| --- | --- |
| Product | Name, thumbnail |
| SKU | Internal ID |
| Type | Product Type |
| Lifecycle | State |
| Accounting | Mapped per entity |
| Prices | Base price per storefront |
| Stock | Available per storefront |
| Images | Status |
| Content | Status |

Global search across public name, accounting name, accounting id, internal SKU, barcode, model, manufacturer, brand and aliases, in Georgian and Latin script. Saved filters, keyboard navigation, safe inline edits.

## 16. Audit, security and operations

The Hub becomes the only source of the rebuilt catalog and of online stock history. Losing it, leaking it or exposing it publicly are the main operational risks.

### 16.1 Audit

Every important change records actor, action, entity, before/after where useful, reason, timestamp (UTC) and correlation id. Audit rows are append-only. Example:

```text
01 Nov 10:14  STOCK_IN +20        AgroTrade online shelf  user: ლიკა   doc: 4471
01 Nov 11:32  RESERVATION −2      Storefront A            service: store-a
01 Nov 13:11  ADJUSTMENT 18 → 17  reason: physical count  user: Admin
```

### 16.2 Security

- Authentication required everywhere; RBAC enforced server-side.
- `X-Robots-Tag: noindex, nofollow` on every response; restrictive security headers (CSP, HSTS, frame-ancestors none).
- CSRF protection appropriate to the session model; rate limiting on login, PIN and API endpoints.
- Upload validation: MIME sniffing, size limits, image re-encoding.
- Private media and evidence served only through signed, short-lived URLs.
- Secrets server-side only; per-storefront API keys hashed at rest.

### 16.3 Hub concealment

- The Hub runs on its own neutral domain, not a subdomain of either storefront.
- An access gateway (e.g. Cloudflare Access or IP allowlist + VPN) sits in front of the admin UI.
- Storefronts call the Hub only from their servers. Browsers of the public never contact the Hub.
- Public images are served from storefront media hosts (§12.3). No public HTML, JS, image URL or email may reveal the Hub hostname.

Acceptance for the chosen gateway: on a real Android phone and a real iPhone, behind the gateway, verify PWA install (manifest and icons load), service worker registration and update, camera access and barcode scanning, IndexedDB offline queue and resync after reconnect, Web Push subscription and delivery. Where the gateway breaks these, exempt only the manifest, icons and service worker script from interactive login redirects, or load the manifest with `crossorigin="use-credentials"`; document the choice in an ADR.

### 16.4 Personal data

The Hub stores only staff personal data (name, email, role, device). Customer data is out of scope by design (§1.3, §11.4).

### 16.5 Offline behaviour

Warehouse connectivity is unreliable. Scans, intake metadata, photos, counts and pick confirmations go into a local IndexedDB queue with idempotency keys. Requirements: visible pending-sync counter, safe retry, resume on reconnect or app reopen, no dependence on OS background sync. Stock-changing actions other than counts and picks require a connection.

### 16.6 Observability

Structured JSON logs with correlation ids, job failure logs, webhook delivery log, health endpoints for app, database and worker. No complex monitoring platform in Phase 1; an uptime check and error alerts to admin email are enough.

### 16.7 Backup and restore

- PostgreSQL: continuous WAL archiving with point-in-time recovery, plus nightly full backup; retention 30 days minimum.
- Object storage: bucket versioning and replication to a second location; raw originals and evidence protected from deletion.
- Backups stored off the application server, encrypted.
- A documented restore procedure, tested on a clean environment before go-live and then quarterly. A successful restore test is part of the Definition of Done.

## 17. Testing, seed data, Definition of Done and milestones

Phase 1 is done when the four end-to-end scenarios below pass on a staging environment restored from backup.

### 17.1 Mandatory automated tests

- **Inventory:** stock in, allocate, deallocate, adjustment, write-off, same-entity transfer, cross-entity transfer in both modes, document-reference enforcement, reservation per payment method, timeout release, concurrent reservation of the last unit, commit, pick to staging, handover, cancellation while reserved, committed and picked (with return to shelf), physical on-hand unchanged by payment, per-location count without false discrepancies, return restock, manual restore, minimum-stock transitions, balances rebuilt from ledger equal materialized balances.
- **Bundles:** composed bundle availability and atomic multi-component reservation.
- **Pricing:** price history, sellability blocked without price, without an enabled listing or without a seller-entity mapping, large-change confirmation.
- **Identity:** multiple identifiers, duplicate scans, identifier collision, one SKU to several accounting mappings across entities, no-barcode intake, label resolves to SKU.
- **Variants:** family with several SKUs, independent stock and mappings.
- **Fulfillment:** status flow, wrong-SKU pick rejected, cancellation restores stock, payload with personal-data fields rejected.
- **Permissions:** warehouse cannot reach admin or price data; stock manager limited to own entity; storefront credential cannot access another storefront.
- **Offline/idempotency:** repeated scan upload creates no duplicates; repeated reservation confirm and fulfillment creation are safe.
- **Reports:** movement report totals equal ledger totals for the period; seller and owner views are correct in both PURCHASE and CONSIGNMENT; sale date and physical exit date are reported separately.

### 17.2 Seed data

Two legal entities (AGROTRADE, NEWBRAND) with a relationship mode, two storefronts, users for every role, several Product Families with variants, accounting mappings in both entities, base prices, storefront listings, pools with SHELF and STAGING locations, allocations, one composed bundle, one no-barcode product, one product needing identification, one low-stock allocation, one open fulfillment request.

### 17.3 Definition of Done — scenarios

**A. Warehouse intake.** Admin creates an intake task → warehouse scans (including one no-barcode product) → guided photos with instant checks → moves on without waiting → worker identifies and attaches evidence → admin is notified, reviews, maps accounting item, internal SKU and label are created → KA/EN content generated → admin approves → admin sets base prices for both storefronts → SKU becomes sellable where all conditions hold. Every step is in the audit log.

**B. Manual online stock.** Stock manager receives 10 units into the AgroTrade pool with a document number → allocates 7 to Storefront A and 3 to Storefront B → weekly count finds 9 → admin approves an adjustment → daily movement report shows all movements and matches the ledger.

**C. Reservation and fulfillment.** Storefront A reserves the last unit by card while a parallel request fails cleanly → payment confirmed → stock committed (available\_to\_sell drops, physical on-hand unchanged) → fulfillment request created → warehouse picks with scan confirmation (SHELF → STAGING) → a count during picking shows no discrepancy → handed over (unit leaves the pool) → webhooks delivered → Storefront B allocation never changed. An installment reservation expires after its timeout and releases stock.

**D. Cross-entity transfer.** In PURCHASE mode, a transfer from AgroTrade to NEWBRAND is blocked without a document reference and succeeds with one, moving stock to the NEWBRAND pool; reports for both entities show it.

Also required: backup restore test passed (§16.7); Georgian UI complete for warehouse flows; PWA verified end-to-end behind the access gateway on Android and iOS (§16.3); OpenAPI document published.

### 17.4 Milestones

Build in this order; each ends runnable, tested, typechecked, linted, with verified migrations. Give the coding agent one milestone at a time. A human reviews migrations and domain tests at the end of each, with extra review of Milestones 8 and 9 (ledger, commitments, reservations) before the next one starts.

1. Foundation: monorepo, database, auth, roles, entities, storefronts, PWA shell, i18n.
2. Product model: families, SKUs, bundles, Product Types, identifiers, accounting mappings.
3. Scanning: tasks, Quick Scan, no-barcode flow, labels, offline queue.
4. Media: guided capture, instant checks, storage, image pipeline.
5. Evidence and AI identity pipeline, deep photo checks.
6. Review workflow and canonical content.
7. Pricing.
8. Inventory: pools, allocations, manual entry, transfers, ledger, counts, replenishment.
9. Reservations, fulfillment, storefront API, outbox, webhooks.
10. Reports, notifications, Web Push, audit polish.
11. Hardening: backups and restore test, security review, end-to-end scenarios, documentation, deployment.

## 18. Open decisions and final principle

Six business decisions remain open. Decision 2 is needed before development starts; the others can wait until the milestone shown. Build the affected parts as configuration.

| # | Decision | Owner | Affects | Needed by |
| --- | --- | --- | --- | --- |
| 1 | Relationship mode between AgroTrade and the new-brand company: PURCHASE or CONSIGNMENT | Both entities' accountants | §4.4, §10.5, reports | Milestone 8 |
| 2 | Who owns the Hub (system, domain, code licence) and how its cost is shared between the two entities | AgroTrade founder, studio | Contract, §16.3 domain | Before development start |
| 3 | Online warehouse/location created in AgroTrade's accounting and physical online shelf set up | AgroTrade | §10.1 | Milestone 8 |
| 4 | Named stock managers per entity and recipients of daily reports | Both entities | §10.9, §10.10, §14 | Milestone 10 |
| 5 | Reservation timeouts per payment method, after bank installment terms are known | Storefront owners | §10.7 | Milestone 9 |
| 6 | Photo corner set up in the warehouse | AgroTrade | §8.2 | Milestone 4 |

### 18.1 Pre-development operational tasks

These tasks are outside the coding agent's scope and start now, in parallel with development. Their output fills `legacy_urls` (§12.5) and drives the future redirect map. Search Console keeps only 16 months of data, so every month of delay loses history.

| Task | Owner | Output | When |
| --- | --- | --- | --- |
| Verify Search Console ownership of agro-trade.ge (or create the property) | AgroTrade + studio | Studio access to the property | Immediately |
| Search Console export: pages, queries, clicks, impressions, average position, indexing status | Studio | Spreadsheet, last 16 months | Immediately, then monthly until launch |
| Full crawl of agro-trade.ge: URLs, page type, title, meta description, H1, canonical, status code, images, internal links; copy of sitemap | Studio | Crawl export + sitemap snapshot | Before development starts |
| Backlink export for agro-trade.ge | Studio | List of linking domains and target URLs | Before the redirect map |
| Analytics export: organic landing pages and conversions, if analytics exists | AgroTrade | Spreadsheet | Before the redirect map |
| Archive copies of key legacy pages (HTML + screenshots) | Studio | Archive folder | Before development starts |

### 18.2 Final engineering principle

The Hub must stay useful when barcode lookup fails, no manufacturer website exists, AI is unavailable, a product has no GTIN, the warehouse network drops, two accounting records map to one SKU, one family has several physical variants, stock is entered by hand, two legal entities share one warehouse, or a third storefront is added.

Model AgroTrade's real operating environment, not clean upstream data. The Hub is the stable bridge between the physical warehouse and the digital storefronts.
