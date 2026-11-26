import { expect, it } from "vitest";
import { asc,sql } from "drizzle-orm";
import type { AuthenticatedPrincipal } from "@khidi/auth";
import { catalogFeedbackCards, catalogLegacyProducts, catalogReviewAssignments, catalogReviewBatches, catalogReviewProposals, catalogReviewPhotos, catalogReviewPhotoLinks,
  connectMigratorDatabase, users, type AppDatabase } from "@khidi/db";
import { createUuidV7 as uuid } from "@khidi/shared";
import { getReviewProduct, listReviewProducts, recordReviewDecision, createReviewText } from "./index.ts";
import { listPilot, savePilot, type FeedbackResponse } from "./pilot.ts";
import { pilotBaseline } from "./access.ts";
import { cardDefinition, fieldKeys, startReview, changes, fieldProblem, mainPhotoProblem, photoKind, shortLine, storeLayout } from "./fields.ts";
import { saveRound,roundDetails } from "./rounds.ts";
import { lockPilotPhotoWork } from "./access.ts";

it("keeps all twenty responses, rejects the twenty-first and never releases on report view", async () => {
  const migrator = connectMigratorDatabase(), rollback = new Error("rollback pilot fixture");
  const person: AuthenticatedPrincipal = { userId: uuid(), role: "CATALOG_REVIEWER", email: null, fullName: "Reviewer",
    locale: "ka", entityIds: [], permissions: [], authMethod: "OFFICE_PASSWORD_TOTP", deviceId: null };
  const admin = { ...person, role: "ADMIN" as const, userId: uuid() };
  const outsider = { ...person, userId: uuid() };
  const batch = uuid();
  try {
    await expect(migrator.db.transaction(async tx => {
      const pilotCards=(await tx.select().from(catalogFeedbackCards).orderBy(asc(catalogFeedbackCards.position))).map(r=>cardDefinition.parse(r.definition));
      const items=[...pilotCards.map(card=>card.wp),...Array.from({length:20},(_,i)=>987654+i)].map(wp=>({wp,id:uuid(),proposal:uuid()}));
      await tx.insert(users).values([person, admin, outsider].map(p => ({
        id: p.userId, fullName: p.fullName, email: p.userId + "@example.test", role: p.role
      })));
      await tx.insert(catalogReviewBatches).values({ id: batch, createdAt: new Date("2000-01-01T00:00:00Z"), sources: { baseline: pilotBaseline },
        sourceSha256: batch.replaceAll("-", "").repeat(2) });
      await tx.insert(catalogReviewAssignments).values({ batchId: batch, userId: person.userId });
      const older = uuid(), alternate = uuid();
      await tx.insert(catalogReviewBatches).values({ id: older, sources: {}, sourceSha256: older.replaceAll("-", "").repeat(2) });
      await tx.insert(catalogReviewAssignments).values({ batchId: older, userId: person.userId });
      await tx.insert(catalogLegacyProducts).values({ id: alternate, batchId: older, wordpressId: 999, sourceStatus: "DRAFT", baseline: {}, reviewSource: {} });
      await tx.insert(catalogReviewProposals).values({ id: uuid(), productId: alternate, field: "NAME", proposed: "alternate",
        observation: "source", rationale: "source" });
      await tx.insert(catalogLegacyProducts).values(items.map((p,i) => ({ id: p.id, batchId: batch, wordpressId: p.wp,
        sourceStatus: "PUBLISHED" as const, baseline: {}, reviewSource: {}, recommendedOrder: i < 20 ? i+1 : null })));
      await tx.insert(catalogReviewProposals).values(items.map(p => ({ id: p.proposal, productId: p.id,
        field: "NAME" as const, proposed: "old", observation: "source", rationale: "source" })));
      const photoId = uuid();
      await tx.insert(catalogReviewPhotos).values({ id: photoId, batchId: batch, assetKey: "fixture", sourceUrl: "https://example.test/p.jpg",
        audit: {}, rawKey: "raw/fixture", rawSha256: "a".repeat(64), previewKey: "master/fixture", previewSha256: "a".repeat(64) });
      await tx.insert(catalogReviewPhotoLinks).values({ batchId: batch, productId: items[0]!.id, photoId, position: 1 });
      const composition = uuid();
      await tx.insert(catalogReviewPhotos).values({ id: composition, batchId: batch, assetKey: "review-"+composition, sourceUrl: "review:"+composition,
        audit: { origin: "COMPOSITION" }, rawKey: "raw/composition", rawSha256: "b".repeat(64), previewKey: "master/composition", previewSha256: "b".repeat(64) });
      await tx.insert(catalogReviewPhotoLinks).values({ batchId: batch, productId: items[0]!.id, photoId: composition, position: 2 });
      await expect(tx.transaction(async nested => { await nested.execute(sql`UPDATE catalog_feedback_round_card_revisions SET note = 'changed'`); }))
        .rejects.toThrow();
      await tx.execute(sql`SET LOCAL ROLE hub_app`);
      const db = tx as unknown as AppDatabase;
      const first = items[0]!, extra = items[20]!;
      const rows=await listPilot(db,person);
      function accepted(i:number):FeedbackResponse {
        const row=rows[i]!, fields=startReview(row.original);for(const k of fieldKeys) fields[k].verdict="OK";
        return { fields,answers:row.card.questions.map(()=>({state:"UNKNOWN",text:"",source:""})),assortment:"ACTIVE" };
      }
      const response=accepted(0);
      // Migration 0063 revises round 1 without touching the append-only revision 1.
      expect(rows.map(r=>r.cardRevision)).toEqual(Array(20).fill(2));
      expect(rows[0]!.card.facts).toHaveLength(15);
      expect(rows.flatMap(r=>r.card.links).some(l=>l.kind==="compare")).toBe(false);
      expect(rows[0]!.photoKinds).toEqual({ [photoId]: "PHOTO", [composition]: "ILLUSTRATION" });
      const release={action:"OPEN" as const,round:1,choice:"KEEP" as const,note:"Keep the tested fields",
        cards:items.slice(20).map(p=>({...pilotCards[0]!,wp:p.wp,links:[]}))};
      const survey={action:"SURVEY" as const,round:1,answers:["First","Second","Third"]};
      await expect(saveRound(db,admin,uuid(),release)).rejects.toMatchObject({code:"CONFLICT"});
      await expect(saveRound(db,person,uuid(),survey)).rejects.toMatchObject({code:"CONFLICT"});
      expect(await listPilot(db, outsider)).toEqual([]);
      expect(await listPilot(db, admin)).toHaveLength(20);
      expect((await listReviewProducts(db, person)).map(r => r.id)).not.toContain(extra.id);
      await expect(getReviewProduct(db, person, extra.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(getReviewProduct(db, person, alternate)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(recordReviewDecision(db, person, uuid(), { proposalId: extra.proposal, revision: 0,
        action: "DEFER" })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(createReviewText(db, person, uuid(), { productId: extra.id, field: "FULL", text: "x" }))
        .rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(savePilot(db, admin, uuid(), { productId: first.id, revision: 0, submit: false, response }))
        .rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(savePilot(db, person, uuid(), { productId: extra.id, revision: 0, submit: true, response }))
        .rejects.toMatchObject({ code: "NOT_FOUND" });
      const answered = rows[0]!.card.questions.map(() => ({ state: "KNOWN" as const, text: "observed", source: "plate" }));
      const draft = { productId: first.id, revision: 0, submit: false, response: { ...response, answers: answered } };
      const key = uuid(), initial = await savePilot(db, person, key, draft);
      expect((await savePilot(db, person, key, draft)).body).toEqual(initial.body);
      await expect(savePilot(db, person, uuid(), draft)).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(savePilot(db, person, uuid(), { ...draft, revision: 1, response: { ...draft.response, fields:{...response.fields,photos:{...response.fields.photos,value:[uuid()]}} } }))
        .rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      await expect(savePilot(db, person, uuid(), { ...draft, revision: 1, submit: true, response: { ...draft.response,
        answers: answered.map(a => ({ ...a, source: "" })) } })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      // A finished card names its assortment status.
      await expect(savePilot(db, person, uuid(), { ...draft, revision: 1, submit: true, response: { ...draft.response, assortment: "" } }))
        .rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      const photosField = response.fields.photos;
      // An illustration may lead only with an acknowledgement and a reason; neither alone is enough to finish.
      const illustrationFirst = { ...response.fields, photos: { ...photosField, value: [composition, photoId], verdict: "EDIT" as const, reason: "shows the blades" } };
      const mainNote = { photoId: composition, checked: true, reason: "buyers ask how the blades sit" };
      for (const mainPhoto of [undefined, { ...mainNote, reason: "" }, { ...mainNote, checked: false }, { ...mainNote, photoId }]) {
        await expect(savePilot(db, person, uuid(), { ...draft, revision: 1, submit: true, response: { ...draft.response,
          fields: illustrationFirst, ...(mainPhoto ? { mainPhoto } : {}) } })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      }
      await expect(savePilot(db, person, uuid(), { ...draft, revision: 1, response: { ...draft.response,
        layout: { order: ["facts","facts","kit","links"], missing: "" } } as unknown as FeedbackResponse }))
        .rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      for (const [i, row] of rows.entries()) {
        await savePilot(db, person, uuid(), { productId: items[i]!.id, revision: i === 0 ? 1 : 0, submit: true,
          response: { ...accepted(i), answers: i === 0 ? answered : row.card.questions.map(() => ({ state: "UNKNOWN", text: "", source: "" })),
            ...(i === 0 ? { fields: illustrationFirst, mainPhoto: mainNote,
              layout: { order: ["facts","description","kit","links"], missing: "price per hectare" }, activeSeconds: 95 } : {}) } });
      }
      const observed = await listPilot(db, admin);
      expect(observed.filter(r => r.submitted)).toHaveLength(20);
      expect(observed[0]?.response?.answers[0]?.source).toBe("plate");
      expect(observed[0]?.response?.fields.photos.value[0]).toBe(composition);
      expect(observed[0]?.response?.mainPhoto).toEqual(mainNote);
      expect(observed[0]?.response?.layout?.order[0]).toBe("facts");
      expect(observed[0]?.response?.activeSeconds).toBe(95);
      await expect(lockPilotPhotoWork(db, person, first.id)).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(savePilot(db, person, uuid(), { ...draft, revision: 2 })).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(getReviewProduct(db, admin, extra.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
      // ADR-017: a complete round cannot be closed early; the closing questions are optional (release is tested below).
      await expect(saveRound(db,admin,uuid(),{action:"CLOSE",round:1,note:"too late"})).rejects.toMatchObject({code:"CONFLICT"});
      await expect(saveRound(db,admin,uuid(),survey)).rejects.toMatchObject({code:"FORBIDDEN"});
      await saveRound(db,person,uuid(),survey);
      expect((await roundDetails(db,observed)).survey?.answers).toEqual(survey.answers);
      await expect(getReviewProduct(db,person,extra.id)).rejects.toMatchObject({code:"NOT_FOUND"});
      await expect(saveRound(db,person,uuid(),release)).rejects.toMatchObject({code:"FORBIDDEN"});
      await expect(saveRound(db,admin,uuid(),{...release,cards:Array(20).fill(release.cards[0])})).rejects.toMatchObject({code:"VALIDATION_ERROR"});
      const releaseKey=uuid();await saveRound(db,admin,releaseKey,release);await saveRound(db,admin,releaseKey,release);
      expect(await listPilot(db,person)).toHaveLength(20);
      expect((await listPilot(db,person))[0]?.round).toBe(2);
      expect((await listPilot(db,admin,1)).map(r=>r.response)).toEqual(observed.map(r=>r.response));
      expect((await getReviewProduct(db,person,extra.id)).product.id).toBe(extra.id);
      // A decided round is frozen for the reviewer as well.
      expect((await listPilot(db,person,1)).every(r=>r.locked)).toBe(true);
      expect((await listPilot(db,person)).some(r=>r.locked)).toBe(false);
      throw rollback;
    })).rejects.toBe(rollback);
  } finally { await migrator.close(); }
},30000);

it("closes a round early, freezes its drafts and opens the next round without the closing questions", async () => {
  const migrator = connectMigratorDatabase(), rollback = new Error("rollback early close fixture");
  const person: AuthenticatedPrincipal = { userId: uuid(), role: "CATALOG_REVIEWER", email: null, fullName: "Reviewer",
    locale: "ka", entityIds: [], permissions: [], authMethod: "OFFICE_PASSWORD_TOTP", deviceId: null };
  const admin = { ...person, role: "ADMIN" as const, userId: uuid() };
  const batch = uuid();
  try {
    await expect(migrator.db.transaction(async tx => {
      const pilotCards=(await tx.select().from(catalogFeedbackCards).orderBy(asc(catalogFeedbackCards.position))).map(r=>cardDefinition.parse(r.definition));
      const items=[...pilotCards.map(card=>card.wp),...Array.from({length:20},(_,i)=>987654+i)].map(wp=>({wp,id:uuid()}));
      await tx.insert(users).values([person, admin].map(p => ({ id: p.userId, fullName: p.fullName, email: p.userId + "@example.test", role: p.role })));
      await tx.insert(catalogReviewBatches).values({ id: batch, createdAt: new Date("2000-01-01T00:00:00Z"), sources: { baseline: pilotBaseline },
        sourceSha256: batch.replaceAll("-", "").repeat(2) });
      await tx.insert(catalogReviewAssignments).values({ batchId: batch, userId: person.userId });
      await tx.insert(catalogLegacyProducts).values(items.map((p,i) => ({ id: p.id, batchId: batch, wordpressId: p.wp,
        sourceStatus: "PUBLISHED" as const, baseline: {}, reviewSource: {}, recommendedOrder: i < 20 ? i+1 : null })));
      await tx.insert(catalogReviewProposals).values(items.map(p => ({ id: uuid(), productId: p.id,
        field: "NAME" as const, proposed: "old", observation: "source", rationale: "source" })));
      await tx.execute(sql`SET LOCAL ROLE hub_app`);
      const db = tx as unknown as AppDatabase;
      const rows = await listPilot(db, person), first = items[0]!, second = items[1]!;
      const fields = startReview(rows[0]!.original);
      fields.name = { ...fields.name, value: ["new name"], verdict: "EDIT", reason: "" };
      const response: FeedbackResponse = { fields, answers: rows[0]!.card.questions.map(() => ({ state: "", text: "", source: "" })) };
      await savePilot(db, person, uuid(), { productId: first.id, revision: 0, submit: false, response });
      // A discontinued product is finished with its status alone: no verdicts, answers or photo checks.
      const third = items[2]!, retired: FeedbackResponse = { fields: startReview(rows[2]!.original), assortment: "DISCONTINUED",
        answers: rows[2]!.card.questions.map(() => ({ state: "", text: "", source: "" })) };
      await savePilot(db, person, uuid(), { productId: third.id, revision: 0, submit: true, response: retired });
      const close = { action: "CLOSE" as const, round: 1, note: "Enough learned from the drafts" };
      const release = { action: "OPEN" as const, round: 1, choice: "CHANGE" as const, note: "Add assortment status",
        cards: items.slice(20).map(p => ({ ...pilotCards[0]!, wp: p.wp, links: [] })) };
      await expect(saveRound(db, admin, uuid(), release)).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(saveRound(db, person, uuid(), close)).rejects.toMatchObject({ code: "FORBIDDEN" });
      const key = uuid(), closed = await saveRound(db, admin, key, close);
      expect((await saveRound(db, admin, key, close)).body).toEqual(closed.body);
      await expect(saveRound(db, admin, uuid(), close)).rejects.toMatchObject({ code: "CONFLICT" });
      const frozen = await listPilot(db, person);
      expect(frozen.every(r => r.locked)).toBe(true);
      expect(frozen[0]!.response?.fields.name.value).toEqual(["new name"]);
      expect(frozen[0]!.submitted).toBe(false);
      const { closure, survey } = await roundDetails(db, frozen);
      expect(closure).toMatchObject({ note: close.note, submitted: 1, drafts: 1, untouched: 18, actor: admin.userId });
      expect(frozen[2]!.response?.assortment).toBe("DISCONTINUED");
      expect(survey).toBeNull();
      await expect(savePilot(db, person, uuid(), { productId: first.id, revision: 1, submit: false, response })).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(savePilot(db, person, uuid(), { productId: second.id, revision: 0, submit: false,
        response: { ...response, answers: rows[1]!.card.questions.map(() => ({ state: "", text: "", source: "" })) } })).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(lockPilotPhotoWork(db, person, second.id)).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(tx.transaction(async nested => { await nested.execute(sql`UPDATE catalog_feedback_round_closures SET note = 'changed'`); }))
        .rejects.toThrow();
      await saveRound(db, admin, uuid(), release);
      const next = await listPilot(db, person);
      expect(next[0]?.round).toBe(2);
      expect(next.some(r => r.locked)).toBe(false);
      expect((await listPilot(db, admin, 1)).map(r => r.response)).toEqual(frozen.map(r => r.response));
      throw rollback;
    })).rejects.toBe(rollback);
  } finally { await migrator.close(); }
},30000);

it("counts a reordering separately from insertions and rejects reverted edits",()=>{
  expect(changes("facts",["A","B","C"],["new","C","A","B"])).toEqual({added:["new"],removed:[],moved:["C (3 → 2)"]});
  expect(changes("description",["ერთი ორი სამი"],["ორი სამი ოთხი"])).toEqual({removed:["ერთი"],added:["ოთხი"],moved:[]});
  expect(fieldProblem("kit",{value:[],verdict:"EDIT",reason:"why",unknown:false},[],true)).toBe(true);
  expect(fieldProblem("kit",{value:[],verdict:"OK",reason:"",unknown:true},[],true)).toBe(false);
  // The reason is optional for EDIT and UNNEEDED; the verdict is not.
  expect(fieldProblem("kit",{value:["new"],verdict:"EDIT",reason:"",unknown:false},[],true)).toBe(false);
  expect(fieldProblem("kit",{value:[],verdict:"UNNEEDED",reason:"",unknown:false},["old"],true)).toBe(false);
  expect(fieldProblem("kit",{value:["new"],verdict:"",reason:"why",unknown:true},[],true)).toBe(true);
  expect(fieldProblem("kit",{value:[],verdict:"UNNEEDED",reason:"why",unknown:true},[],true)).toBe(true);
  expect(shortLine("მოტობლოკი",["ბრენდი: ჰირომიკი","სიმძლავრე: 7 ცხ.ძ., 3600 ბრ/წთ","ღერძი: მსხვილი"])).toEqual(["მოტობლოკი","7 ცხ.ძ.","მსხვილი"]);
  expect(storeLayout.safeParse({order:["kit","facts","links","description"],missing:""}).success).toBe(true);
  expect(storeLayout.safeParse({order:["kit","kit","links","description"],missing:""}).success).toBe(false);
  const id="018f0000-0000-7000-8000-000000000001";
  expect([photoKind("UPLOAD"),photoKind("ADJUSTED"),photoKind(undefined),photoKind("AI_EDIT"),photoKind("COMPOSITION")])
    .toEqual(["PHOTO","PHOTO","PHOTO","AI_EDIT","ILLUSTRATION"]);
  expect(mainPhotoProblem("PHOTO",id,undefined)).toBe(false);
  expect(mainPhotoProblem("AI_EDIT",id,undefined)).toBe(true);
  expect(mainPhotoProblem("AI_EDIT",id,{photoId:id,checked:true,reason:""})).toBe(false);
  expect(mainPhotoProblem("ILLUSTRATION",id,{photoId:id,checked:true,reason:" "})).toBe(true);
});
