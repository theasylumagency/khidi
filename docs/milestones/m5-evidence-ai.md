# M5 — Evidence and AI identity

[ADR-010](../adr/ADR-010-evidence-identity-and-house-defined-products.md) defines the evidence registry, field verification, identity confidence and READY eligibility. Migrations `0016` through `0019` add the registry, computed identity, AI job accounting, claim origins and private PDF attachments. Upgrading a legacy READY SKU preserves its status and slug, records LOW and queues an action for the admin. A later identity conflict blocks sellability while the SKU stays READY.

## Admin review

1. Open the SKU and assign its Product Type. In the evidence section, request a carton photo, marking photo, supplier document photo or measurement from the warehouse when needed. Attach emailed specification sheets, passports or supplier documents as PDFs up to 15 MiB. Open them from the SKU review with your signed admin link.
2. Check that each item belongs to the SKU, confirm its readings and accept or reject it with a reason. For one Medium source, confirm the specific field separately. In Missing information, filter by the supplier recorded on evidence and export the list to CSV.
3. For a product without documents, verify MAIN and SECONDARY photos and record an administrative physical inspection. Verify the observable distinguishing attributes and record a reason for each that cannot be determined. For a similar READY SKU, record an observable difference or verify a differing attribute before proceeding.
4. Complete accounting and content review. Review the computed MEDIUM result, confirm it explicitly and approve READY. The SKU receives a canonical slug without an invented model. On collision, try a short distinguishing term first.
5. Open Notifications to review READY items flagged for re-verification. Resolve an identity conflict by reviewing the evidence or move the SKU back through the lifecycle to change its identity.

## Background jobs

`media:jobs:deploy` registers the evidence AI queues alongside the existing media queues. The Jobs page shows job status, attempts, provider, model, prompt version, token usage and cost. The daily limit uses integer USD micros and Tbilisi calendar days. An attempt that may have reached a provider but lacks usage information retains its reservation. An admin can retry a deferred or failed job.

The configured modes are `disabled` and the local `synthetic` adapter. Fixture tests supply deterministic provider responses, including quality checks and candidate readings. Operator work proceeds when AI is disabled. The provider input uses hash-checked processed masters or derivatives with metadata removed. OCR, plate, marking and identification-photo jobs use the master to keep small text readable. Supplier documents, original photos, `INTERNAL_ONLY` evidence and commercial fields stay internal. Before enabling an external adapter, verify that image pixels sent to it also exclude printed prices and commercial material. See [shared server setup](../ops/server-setup.md).

## Pilot review

Use synthetic data on an isolated deployment. On Android and iPhone, open an assigned evidence request from the installed PWA. Capture a carton or marking photo, submit a measurement, and check that a document photo is available only in admin review. On desktop, complete the no-document path above and verify that a conflicting reading is hidden from storefront facts while the approved slug is preserved. A full SKU merge workflow remains separate from this review flow.

The automated coverage includes pending and accepted source rules, the no-document READY transition, blocking and distinguishing similar variants, re-verification after a conflict, private provider inputs, concurrent budget enforcement and replay of evidence and lifecycle API requests. A separate local upgrade exercise used a legacy READY fixture and ran a synthetic job through the worker queues as `hub_app`.
