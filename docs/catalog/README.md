# Reference taxonomy — approved scope

Owner decision: 2026-11-08. These status boundaries override the older recommendation/approval
checkboxes inside the preserved source documents. The original PDF/Markdown files are retained
unchanged; a source document's title is not approval of every feature it describes.

- Architecture v1.0: eight public categories, original 30 Product Types and default category
  mappings are agreed. Second-level public subcategories and filters remain recommendations.
- Annex B: GENERATOR, LADDER, CONSUMABLE are approved, extending the catalog to 33 types with
  their attributes, subtype lists, photo instructions, naming and research contracts. Gloves
  remain an open classification question. WordPress IDs in §4 are hints for later intake;
  no record, product, duplicate merge or old-site content is imported.
- Annex A: controlled subtype vocabularies and required specification fields only. The six
  SPARE_PART entries and Annex B's CONSUMABLE entries are defined. The source files do not
  contain full ACCESSORY, POWER_TOOL or FARM_PROCESSOR tables: keep their existing vocabularies.
  ADMIN may add a key and KA/EN labels to these three through the UI, with an empty required-spec
  list. The owner will define the missing tables after the first intake wave. Future approved
  fields/requirements are applied by the same reference command without schema changes.
- Compatibility, fit_status, engine_models, uses_engine, inheritance, spec matching, two-stage
  publishing, host navigation and parts finder are excluded from M11. A plain engine_model
  reading in the attribute/evidence registry is not a compatibility relationship.

The explicit engine-plate owner clarification adds capture / checked absence / later. Absence
is attributed NOT_FOUND with PLATE_ABSENT, never a technical value or a substitute for an
ADMIN field-level unknown decision. Accepted evidence still wins. An absent plate alone does
not block the ADR-010 HOUSE_DEFINED → MEDIUM → explicitly confirmed READY path.

The versioned runtime reference package is in packages/products/src/taxonomy.ts and
catalog-additions.ts. Operations never parse supplier/legacy documents into truth. The exact
comparison and the command are documented in [H10](../milestones/m11-h10-reference-setup.md).
Business configuration (legal entities, pools, stores and relationships) is entered through
ADMIN UI; reference data creates none of it and never invokes development seeds.
