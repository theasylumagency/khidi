import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { storefrontApiKeys, storefrontApiRateWindows, storefronts, users, type AppDatabase, type DbExecutor } from "@khidi/db";
import { executeIdempotent, withDomainTransaction } from "@khidi/domain";
import { AppError, createUuidV7, sha256Hex } from "@khidi/shared";
import { assertRecentStrongAuth } from "./security-session.ts";
import type { AuthenticatedPrincipal } from "./principal.ts";
import { isIP } from "node:net";
import { z } from "zod";
export async function issueStorefrontApiKey(
  db: AppDatabase | DbExecutor,
  adminPrincipal: AuthenticatedPrincipal,
  input: {
    storefrontId: string;
    name: string;
    allowedIps?: string[];
    expiresAt?: Date;
    rateLimitPerMinute?: number;
  }
): Promise<{ id: string; keyPrefix: string; rawApiKey: string }> {
  if(adminPrincipal.role!=="ADMIN") throw new AppError("FORBIDDEN","Only ADMIN manages service keys.");

  const [storefront] = await db
    .select()
    .from(storefronts)
    .where(eq(storefronts.id, input.storefrontId))
    .limit(1);

  if (!storefront) {
    throw new AppError("NOT_FOUND", `Storefront ${input.storefrontId} not found.`);
  }

  const randomPart = randomBytes(24).toString("hex");
  const keyPrefix = "sf_"+randomBytes(6).toString("hex");
  const rawApiKey = `${keyPrefix}_${randomPart}`;
  const keyHash = sha256Hex(rawApiKey);
  const id = createUuidV7();

  await withDomainTransaction(db, { userId: adminPrincipal.userId }, async (ctx) => {
    await assertRecentStrongAuth(ctx.tx, adminPrincipal);
    await ctx.tx.insert(storefrontApiKeys).values({
      id,
      storefrontId: storefront.id,
      name: input.name.trim(),
      keyPrefix,
      keyHash,
      allowedIps: input.allowedIps ?? null,
      active: true,
      expiresAt:input.expiresAt??null,
      rateLimitPerMinute:input.rateLimitPerMinute??120,
      createdBy: adminPrincipal.userId
    });

    await ctx.recordAudit({
      action: "STOREFRONT_API_KEY_ISSUED",
      entityType: "storefront_api_key",
      entityId: id,
      after: { storefrontId: storefront.id, name: input.name.trim(), keyPrefix }
    });
    await ctx.emitOutboxEvent({eventType:"STOREFRONT_API_KEY_CHANGED",aggregateType:"storefront_api_key",aggregateId:id,payload:{action:"ISSUED"},consumers:[]});
  });

  return { id, keyPrefix, rawApiKey };
}

const keySettings={name:z.string().trim().min(1).max(100),allowedIps:z.array(z.string().max(45).refine((s)=>isIP(s)!==0)).max(50).default([]),
  expiresAt:z.string().max(128).datetime({offset:true}).optional(),rateLimitPerMinute:z.number().int().min(1).max(10000).default(120)};
export const serviceKeyCommandSchema=z.discriminatedUnion("action",[
  z.object({action:z.literal("ISSUE"),storefrontId:z.string().max(36).uuid(),...keySettings}).strict(),
  z.object({action:z.literal("ROTATE"),keyId:z.string().max(36).uuid(),...keySettings}).strict(),
  z.object({action:z.literal("REVOKE"),keyId:z.string().max(36).uuid()}).strict()
]);
export async function listStorefrontServiceKeys(db:DbExecutor,p:AuthenticatedPrincipal) {
  const [admin]=await db.select().from(users).where(and(eq(users.id,p.userId),eq(users.active,true),eq(users.role,"ADMIN")));
  if(!admin) throw new AppError("FORBIDDEN","Only ADMIN manages service keys.");
  return db.select({id:storefrontApiKeys.id,storefrontId:storefrontApiKeys.storefrontId,name:storefrontApiKeys.name,keyPrefix:storefrontApiKeys.keyPrefix,
    active:storefrontApiKeys.active,allowedIps:storefrontApiKeys.allowedIps,expiresAt:storefrontApiKeys.expiresAt,lastUsedAt:storefrontApiKeys.lastUsedAt,
    rateLimitPerMinute:storefrontApiKeys.rateLimitPerMinute,createdAt:storefrontApiKeys.createdAt}).from(storefrontApiKeys);
}
/** Idempotency stores metadata only. A replay never recovers a raw credential. */
export async function manageStorefrontServiceKey(db:DbExecutor,p:AuthenticatedPrincipal,key:string,raw:unknown) {
  const parsed=serviceKeyCommandSchema.safeParse(raw);
  if(!parsed.success || !z.string().max(36).uuid().safeParse(key).success) throw new AppError("VALIDATION_ERROR","Invalid service key command.");
  await listStorefrontServiceKeys(db,p);await assertRecentStrongAuth(db,p);
  let rawApiKey:string|undefined;
  const result=await executeIdempotent(db,{scope:"service-key:"+p.userId,idempotencyKey:key,payload:parsed.data},async(tx)=>withDomainTransaction(tx,{userId:p.userId},async(ctx)=>{
    const input=parsed.data;
    let storefrontId=input.action==="ISSUE" ? input.storefrontId : "";
    if(input.action!=="ISSUE") {
      const [old]=await ctx.tx.select().from(storefrontApiKeys).where(eq(storefrontApiKeys.id,input.keyId)).for("update");
      if(!old?.active) throw new AppError("NOT_FOUND","Active service key not found.");
      storefrontId=old.storefrontId;
      await ctx.tx.update(storefrontApiKeys).set({active:false,revokedAt:new Date()}).where(eq(storefrontApiKeys.id,old.id));
      await ctx.recordAudit({action:"STOREFRONT_API_KEY_REVOKED",entityType:"storefront_api_key",entityId:old.id,after:{active:false}});
      await ctx.emitOutboxEvent({eventType:"STOREFRONT_API_KEY_CHANGED",aggregateType:"storefront_api_key",aggregateId:old.id,payload:{action:"REVOKED"},consumers:[]});
    }
    if(input.action==="REVOKE") return {status:200,body:{ok:true,id:input.keyId,keyPrefix:""}};
    const issued=await issueStorefrontApiKey(ctx.tx,p,{storefrontId,name:input.name,allowedIps:input.allowedIps,
      expiresAt:input.expiresAt ? new Date(input.expiresAt) : undefined,rateLimitPerMinute:input.rateLimitPerMinute});
    rawApiKey=issued.rawApiKey;
    return {status:201,body:{ok:true,id:issued.id,keyPrefix:issued.keyPrefix}};
  }));
  return {...result,body:{...result.body,...(rawApiKey ? {rawApiKey} : {})}};
}

/** A database window is shared by every Hub process; client headers cannot reset it. */
export async function consumeStorefrontRateLimit(db:DbExecutor,p:{apiKeyId:string;storefrontId:string;rateLimitPerMinute:number}) {
  const result=await withDomainTransaction(db,{storefrontId:p.storefrontId,principalType:"STOREFRONT_SERVICE",principalId:p.apiKeyId},async(ctx)=>{
    const clock=await ctx.tx.execute(sql`SELECT clock_timestamp() AS now`),now=new Date((clock.rows[0] as {now:Date}).now);
    const inserted=await ctx.tx.insert(storefrontApiRateWindows).values({apiKeyId:p.apiKeyId,windowStartedAt:now,requests:1}).onConflictDoNothing().returning();
    const [window]=await ctx.tx.select().from(storefrontApiRateWindows).where(eq(storefrontApiRateWindows.apiKeyId,p.apiKeyId)).for("update");
    const age=now.getTime()-window!.windowStartedAt.getTime();
    const [key]=await ctx.tx.select().from(storefrontApiKeys).where(eq(storefrontApiKeys.id,p.apiKeyId));
    if(!key?.active || key.revokedAt) throw new AppError("UNAUTHORIZED","Invalid service credential.");
    const first=inserted.length>0;
    if(!first && age<60000 && window!.requests>=p.rateLimitPerMinute) return {retryAfter:Math.max(1,Math.ceil((60000-age)/1000))};
    const count=first ? 1 : age>=60000 ? 1 : window!.requests+1;
    await ctx.tx.update(storefrontApiRateWindows).set({requests:count,...(age>=60000 ? {windowStartedAt:now} : {})}).where(eq(storefrontApiRateWindows.apiKeyId,p.apiKeyId));
    await ctx.tx.update(storefrontApiKeys).set({lastUsedAt:now}).where(eq(storefrontApiKeys.id,p.apiKeyId));
    await ctx.recordAudit({action:"STOREFRONT_API_REQUESTED",entityType:"storefront_api_key",entityId:p.apiKeyId,after:{requests:count}});
    await ctx.emitOutboxEvent({eventType:"STOREFRONT_API_REQUESTED",aggregateType:"storefront_api_key",aggregateId:p.apiKeyId,payload:{},consumers:[]});
    return {retryAfter:0};
  });
  if(result.retryAfter) throw new AppError("FORBIDDEN","Request rate exceeded.",{retryAfter:result.retryAfter});
}

export async function verifyStorefrontServiceCredential(
  db: AppDatabase | DbExecutor,
  input: {
    requestedStorefrontKey: string;
    rawApiKey: string;
    clientIp?: string;
  }
): Promise<{ storefrontId: string; storefrontKey: string; sellerEntityId: string; apiKeyId:string; rateLimitPerMinute:number }> {
  const keyHash = sha256Hex(input.rawApiKey);

  const [keyRow] = await db
    .select({
      keyId: storefrontApiKeys.id,
      rateLimitPerMinute:storefrontApiKeys.rateLimitPerMinute,
      keyActive: storefrontApiKeys.active,
      revokedAt: storefrontApiKeys.revokedAt,
      expiresAt: storefrontApiKeys.expiresAt,
      allowedIps: storefrontApiKeys.allowedIps,
      storefrontId: storefronts.id,
      storefrontKey: storefronts.key,
      storefrontActive: storefronts.active,
      sellerEntityId: storefronts.sellerEntityId
    })
    .from(storefrontApiKeys)
    .innerJoin(storefronts, eq(storefrontApiKeys.storefrontId, storefronts.id))
    .where(eq(storefrontApiKeys.keyHash, keyHash))
    .limit(1);

  if (!keyRow || !keyRow.keyActive || keyRow.revokedAt || !keyRow.storefrontActive) {
    throw new AppError("UNAUTHORIZED", "Invalid or revoked storefront service credential.");
  }

  if (keyRow.expiresAt && keyRow.expiresAt <= new Date()) {
    throw new AppError("UNAUTHORIZED", "Storefront service credential has expired.");
  }

  // Strict storefront scope check: credential for Storefront A can never access Storefront B (§12, §17.1)
  if (keyRow.storefrontKey !== input.requestedStorefrontKey) {
    throw new AppError(
      "FORBIDDEN",
      `Storefront credential is scoped to "${keyRow.storefrontKey}" and cannot access "${input.requestedStorefrontKey}".`
    );
  }

  if (keyRow.allowedIps && keyRow.allowedIps.length > 0) {
    if (!input.clientIp || !keyRow.allowedIps.includes(input.clientIp)) {
      throw new AppError("FORBIDDEN", "Client IP is not on the storefront credential allowlist.");
    }
  }



  return {
    storefrontId: keyRow.storefrontId,
    storefrontKey: keyRow.storefrontKey,
    sellerEntityId: keyRow.sellerEntityId,apiKeyId:keyRow.keyId,rateLimitPerMinute:keyRow.rateLimitPerMinute
  };
}

