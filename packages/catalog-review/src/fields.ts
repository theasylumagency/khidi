import { z } from "zod";
export const fieldKeys = ["name","description","facts","kit","links","photos"] as const;
export type FieldKey = typeof fieldKeys[number];
// "fits" points from an accessory, part or consumable to the machine it is used with.
export const relationKinds = ["compare","alternative","attachment","part","kit","supply","fits"] as const;
const line = z.string().trim().min(1).max(300);
export const cardDefinition = z.object({
  wp: z.number().int().positive(), type: line, name: line, description: z.string().trim().min(1).max(4000),
  facts: z.array(line).max(32), kit: z.array(line).max(32),
  links: z.array(z.object({ wp: z.number().int().positive(), kind: z.enum(relationKinds) }).strict()).max(32),
  questions: z.array(z.object({ field: line, prompt: z.string().trim().min(1).max(800) }).strict()).max(8)
}).strict();
export type CardDefinition = z.infer<typeof cardDefinition>;
// Store-page sections the reviewer may reorder; name and photos stay at the top of a product page.
export const storeSections = ["description","facts","kit","links"] as const;
export const storeLayout = z.object({ order: z.array(z.enum(storeSections)).length(storeSections.length)
  .refine(order => new Set(order).size === order.length), missing: z.string().trim().max(1600) }).strict();
export type StoreLayout = z.infer<typeof storeLayout>;
// A fact line reads "label: value"; the label is optional for free text.
export function splitFact(line: string): [string, string] {
  const i = line.indexOf(":");
  return i < 0 ? ["", line.trim()] : [line.slice(0, i).trim(), line.slice(i + 1).trim()];
}
const shortLineLabels = ["სიმძლავრე","ძრავის მოცულობა","ხსნარის ავზი","ავზი","ბარაბანი","დისკის დიამეტრი","დიამეტრი","ზომა",
  "მაქსიმალური დატვირთვა","ღერძი"];
// The automatic short line: product type plus up to three key facts, first value before a comma.
export function shortLine(type: string, facts: string[]) {
  const pairs = facts.map(splitFact), out = [type];
  for (const label of shortLineLabels) {
    const found = pairs.find(([k]) => k === label);
    if (found && out.length < 4) out.push(found[1].split(",")[0]!.trim());
  }
  return out.filter(Boolean);
}
/**
 * What the reviewer must confirm before a photo can lead the card.
 * PHOTO: an upload or deterministic adjustment. AI_EDIT: a real photo whose surroundings an AI model changed
 * (clean-up, white background); it may lead after she confirms the product itself is unchanged.
 * ILLUSTRATION: composed or generated content (mounted detail, inset, scene); not advised as the main photo,
 * allowed in the pilot only with an acknowledgement and a reason so the choice can be studied.
 */
export type PhotoKind = "PHOTO" | "AI_EDIT" | "ILLUSTRATION";
export const mainPhotoNote = z.object({ photoId: z.string().uuid(), checked: z.boolean(), reason: z.string().trim().max(600) }).strict();
export type MainPhotoNote = z.infer<typeof mainPhotoNote>;
export function photoKind(origin: unknown): PhotoKind {
  return origin === "COMPOSITION" ? "ILLUSTRATION" : origin === "AI_EDIT" ? "AI_EDIT" : "PHOTO";
}
export function mainPhotoProblem(kind: PhotoKind, photoId: string | undefined, note: MainPhotoNote | undefined) {
  if (!photoId || kind === "PHOTO") return false;
  if (note?.photoId !== photoId || !note.checked) return true;
  return kind === "ILLUSTRATION" && !note.reason.trim();
}

export const roundQuestions = ["რა აკლდა ყველა ბარათს?", "რომელ ველს არასდროს შეავსებდით მაღაზიაში?",
  "რას გეკითხებიან მყიდველები ყველაზე ხშირად, რაც ბარათზე არ ჩანს?"] as const;
const fieldReview = z.object({ value: z.array(z.string().trim().max(4000)).max(32),
  verdict: z.enum(["","OK","EDIT","UNNEEDED"]), reason: z.string().trim().max(600), unknown: z.boolean() }).strict();
export const assessments = z.object({ name: fieldReview, description: fieldReview, facts: fieldReview,
  kit: fieldReview, links: fieldReview, photos: fieldReview }).strict();
export type Assessments = z.infer<typeof assessments>;
export type Originals = Record<FieldKey,string[]>;
export function originals(card: CardDefinition, photos: string[]): Originals {
  return { name:[card.name], description:[card.description], facts:card.facts, kit:card.kit,
    links:card.links.map(link => link.kind+":"+link.wp), photos };
}
export function startReview(source: Originals): Assessments {
  return Object.fromEntries(fieldKeys.map(key => [key,{value:source[key],verdict:"",reason:"",unknown:false}])) as Assessments;
}
export function sameValues(a: string[], b: string[]) { return a.length === b.length && a.every((v,i) => v === b[i]); }
export function fieldProblem(key: FieldKey, f: Assessments[FieldKey], source: string[], submit: boolean) {
  const single = key === "name" || key === "description";
  if (single && f.value.length > 1 || f.value.some(v => !v || v.length > (key === "description" ? 4000 : 300))) return true;
  if (!submit) return false;
  // Owner decision 2026-11-25: the reason for EDIT/UNNEEDED is optional; a verdict is still required.
  if (!f.verdict) return true;
  if (f.verdict === "UNNEEDED") return f.value.length !== 0 || f.unknown;
  return f.verdict === "OK" ? !sameValues(source,f.value) : sameValues(source,f.value);
}
// A longest increasing subsequence identifies items that retain their relative
// order. Inserting one new row therefore never counts the following rows as moves.
export function changes(key: FieldKey, before: string[], after: string[]) {
  const tokens = (v: string[]) => key === "name" || key === "description" ? v.join(" ").match(/\S+/gu) ?? [] : v;
  const a=tokens(before), b=tokens(after), positions=new Map<string,number[]>();
  a.forEach((word,i) => { const list=positions.get(word) ?? []; list.push(i); positions.set(word,list); });
  const matched=b.map(word => positions.get(word)?.shift() ?? -1), tails:number[]=[], parent:number[]=[];
  matched.forEach((n,i) => {
    if (n<0) return;
    let low=0, high=tails.length;
    while (low<high) { const mid=(low+high)>>>1; if (matched[tails[mid]!]!<n) low=mid+1; else high=mid; }
    parent[i]=tails[low-1] ?? -1; tails[low]=i;
  });
  const stable=new Set<number>(), used=new Set(matched);
  for (let i=tails.at(-1) ?? -1; i>=0; i=parent[i]!) stable.add(i);
  return { removed:a.filter((_,i)=>!used.has(i)), added:b.filter((_,i)=>matched[i]===-1),
    moved:b.flatMap((word,i)=>matched[i]!==-1 && !stable.has(i) ? [word+" ("+(matched[i]!+1)+" → "+(i+1)+")"] : []) };
}
