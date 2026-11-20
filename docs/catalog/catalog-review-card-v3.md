# Catalog Review pilot — card v3 (store preview)

Status: proposal for round 1, before the reviewer opens the first card.
Inputs: [`pilot/round1-cards-v3.json`](pilot/round1-cards-v3.json) (20 card definitions, same WordPress IDs and
positions as round 1), and the clickable prototype [`pilot/store-preview-prototype.html`](pilot/store-preview-prototype.html)
(open locally in a browser; state stays in that browser).

## Why

Round 1 as deployed loses most source facts (44 facts on 20 cards against 167 in the source),
writes 18 of 20 descriptions with one “თუ …, …” template, shows internal duplicate checks as
buyer relations (`compare`, 9 links) and asks the reviewer to judge fields in a long form that
looks nothing like a store page. The pilot exists to learn how a store representative reads and
rewrites a product page, so the reviewer must see the product roughly as a buyer will.

## 1. Content (round 1)

- Replace the 20 round-1 definitions with `pilot/round1-cards-v3.json`, same IDs and positions.
  `catalog_feedback_round_cards` is append-only (`enforce_append_only_table`), so a migration
  cannot simply update `definition`. **Open question for the owner before implementation:**
  1. *Card revisions (recommended).* New append-only table, e.g.
     `catalog_feedback_round_card_revisions(round_no, position, revision, definition, actor, created_at)`.
     `listPilot` reads the latest revision; a card that already has a feedback entry keeps the
     definition snapshot stored in that entry. Revision 2 for round 1 is inserted by migration
     only for positions without entries.
  2. *Restart as round 2.* Leave round 1 as the archived first draft and open round 2 with these
     cards. The current OPEN action requires a completed round 1, so this needs an admin
     “void round” decision recorded in the audit log.
  Do not lift the append-only trigger.
- The file follows `cardDefinition` in `packages/catalog-review/src/fields.ts`, with one change:
  add relation kind `fits` (accessory → host machine), label `ერგება`.
- Rules the content follows. Keep them for later rounds and the admin template:
  - Every fact in the old record appears in `facts` or in a question. Nothing silently dropped.
  - `facts` lines are `label: value`, one fact per line, buyer wording, units normalised.
  - Descriptions are 2–4 plain sentences: what it is and for what work, what the numbers mean
    for the buyer, the nearest alternative in the cohort. No internal notes, no store terms
    (delivery, installments, addresses), no fixed sentence template.
  - Conflicts, duplicates and unknowns go to `questions`, never to `description` or `links`.
  - No `compare` links. Duplicate pairs (7171/7393, 8135/8138, 7296/7299) are questions.

## 2. Review screen

Follow the prototype.

- **Left: the store page.** A neutral, brand-less store frame: header, breadcrumb (category ›
  type), gallery, title, brand · code line, auto short line as chips, price/stock placeholder
  (“from Hub”), buy buttons (inactive), key facts (first four non-identity facts), then the
  sections description · specifications table · kit · related products.
- **Review strip under each of the six fields** (name, photos, description, facts, kit, links):
  `სწორია` · `შევცვლი` (opens inline editing in place) · `არ სჭირდება` · `ვერ ვადასტურებ`
  (independent flag). Changing the value sets `EDIT` automatically and disables `სწორია`.
  `EDIT`/`UNNEEDED` requires a one-sentence reason. Show a compact before → after diff.
- **Section order.** ↑/↓ on description, facts, kit and links. The chosen order is captured.
- **“რა აკლია ამ გვერდს?”** One optional free-text field per card.
- **Right rail.** Card checklist (six dots), the first missing item, “finish card”; tabs
  **Questions** (answer + source chips: plate, manual, box, supplier, sales experience; or
  “don't know”) and **Old site** (old name, short and full text, always one click away).
- **Toggles:** `მყიდველის თვალით` hides all review chrome; `ტელეფონი` renders the store frame
  at ~390 px. Buyers are mostly on phones.
- **Photos:** real previews at gallery size, reorder, first is main, remove. AI compositions
  carry an “ილუსტრაცია” badge and cannot become the main photo. A card without photos shows
  “ფოტო არ არის · გადაღებაა საჭირო”.
- **Related products:** buyer label by kind (ერგება, მისაბმელი იარაღი, სათადარიგო ნაწილი,
  კომპლექტშია, სახარჯი მასალა, შეადარეთ) plus “დასადასტურებელი” in review mode. Adding a link
  searches the whole catalog, not only the cohort.

## 3. Data captured per card

Extend the stored response (append-only, versioned as today):

```ts
{
  fields: Record<FieldKey, { value: string[]; verdict: "" | "OK" | "EDIT" | "UNNEEDED"; reason: string; unknown: boolean }>,
  layout: { order: ("description" | "facts" | "kit" | "links")[]; missing: string },
  answers: { state: "KNOWN" | "UNKNOWN"; text: string; source: string }[],
  activeSeconds: number   // visible-tab time on the card, for effort per field type
}
```

The results page and XLSX add: section order changed (yes/no + order), “missing” text,
active minutes, and per field the before/after with the reason. The three closing survey
questions after card 20 stay as implemented.

## 4. Auto short line

`type` plus up to three facts by priority: სიმძლავრე, ძრავის მოცულობა, ხსნარის ავზი, ავზი,
ბარაბანი, დისკის დიამეტრი, დიამეტრი, ზომა, მაქსიმალური დატვირთვა, ღერძი. First value before a comma.
Example: `მოტობლოკი · 7 ცხ.ძ. · მსხვილი`.

## 5. Acceptance

- All 20 cards open in the store frame; facts per card equal the JSON (167 total).
- A field cannot be finished as `OK` after its value changed; `EDIT`/`UNNEEDED` without a reason blocks finishing.
- Buyer view shows no review controls; phone view has no horizontal scroll.
- Export contains `layout.order`, `layout.missing` and `activeSeconds` for every submitted card.
- No `compare` link and no internal note is visible in buyer view.
