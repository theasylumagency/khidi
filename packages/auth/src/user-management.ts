import { randomBytes } from "node:crypto";
import { and,eq,inArray,isNull,sql } from "drizzle-orm";
import { users,userEntityMemberships,userPermissions,userSetupLinks,userPasskeys,sessions,registeredDevices,legalEntities,systemSettings,type DbExecutor } from "@khidi/db";
import { executeIdempotent,withDomainTransaction,type DomainTransactionContext } from "@khidi/domain";
import { AppError,createUuidV7,sha256Hex,USER_ROLES,GRANULAR_PERMISSIONS } from "@khidi/shared";
import { z } from "zod";
import { assertRecentStrongAuth } from "./security-session.ts";
import { hashSecret } from "./credentials.ts";
import { officePassword } from "./password-policy.ts";
import { webauthnConfig } from "./webauthn-config.ts";
import type { AuthenticatedPrincipal } from "./principal.ts";

const id=z.string().max(36).uuid(),fields={fullName:z.string().trim().min(1).max(200),email:z.string().trim().max(254).email().transform(s=>s.toLowerCase()).nullable(),
 role:z.enum(USER_ROLES),entityIds:z.array(id).max(50),permissions:z.array(z.enum(GRANULAR_PERMISSIONS)).max(GRANULAR_PERMISSIONS.length)};
export const userManagementCommand=z.discriminatedUnion("action",[
 z.object({action:z.literal("CREATE"),...fields}).strict(),z.object({action:z.literal("EDIT"),id,...fields}).strict(),
 z.object({action:z.literal("ACTIVE"),id,active:z.boolean()}).strict(),
 z.object({action:z.enum(["ISSUE","RESET"]),id}).strict(),
 z.object({action:z.literal("TTL"),hours:z.number().int().positive().max(Math.floor(Number.MAX_SAFE_INTEGER/3600000))}).strict()
]);
type Command=z.infer<typeof userManagementCommand>;
const forbidden=()=>new AppError("FORBIDDEN","User management requires ADMIN and recent strong authentication.");
async function admin(db:DbExecutor,p:AuthenticatedPrincipal) {
 if(p.role!=="ADMIN")throw forbidden();
 const context=await assertRecentStrongAuth(db,p);if(context.user.role!=="ADMIN")throw forbidden();return context;
}
export async function authorizeUserManagement(db:DbExecutor,p:AuthenticatedPrincipal) {
 await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('khidi-user-management',0))`);
 return admin(db,p);
}
export async function revokeUserSessionsAndSetup(db:DbExecutor,userId:string) {
 await db.delete(sessions).where(eq(sessions.userId,userId));
 await db.update(userSetupLinks).set({revokedAt:new Date()}).where(and(eq(userSetupLinks.userId,userId),isNull(userSetupLinks.usedAt),isNull(userSetupLinks.revokedAt)));
}
async function revokeAccess(ctx:DomainTransactionContext,userId:string) {
 await revokeUserSessionsAndSetup(ctx.tx,userId); // push subscriptions cascade immediately
}
async function record(ctx:DomainTransactionContext,id:string,action:string,before:Record<string,unknown>|null,after:Record<string,unknown>) {
 await ctx.recordAudit({action,entityType:"user",entityId:id,before,after});
 await ctx.emitOutboxEvent({eventType:"USER_MANAGEMENT_CHANGED",aggregateType:"user",aggregateId:id,payload:{action},consumers:[]});
}
export async function setupLinkHours(db:DbExecutor) {
 const [setting]=await db.select().from(systemSettings).where(eq(systemSettings.key,"user_setup_link_hours"));
 const hours=setting?.valueJson.hours??72;if(typeof hours!=="number"||!Number.isSafeInteger(hours)||hours<1||!Number.isFinite(new Date(Date.now()+hours*3600000).getTime()))throw new AppError("INVARIANT_VIOLATION","Invalid setup link lifetime.");return hours;
}
async function issue(ctx:DomainTransactionContext,p:AuthenticatedPrincipal,user:typeof users.$inferSelect) {
 if(!user.active)throw new AppError("PRECONDITION_FAILED","Activate this user before issuing setup.");
 await ctx.tx.update(userSetupLinks).set({revokedAt:new Date()}).where(and(eq(userSetupLinks.userId,user.id),isNull(userSetupLinks.usedAt),isNull(userSetupLinks.revokedAt)));
 const token=randomBytes(32).toString("base64url"),expiresAt=new Date(Date.now()+await setupLinkHours(ctx.tx)*3600000);
 await ctx.tx.insert(userSetupLinks).values({id:createUuidV7(),userId:user.id,tokenHash:sha256Hex(token),kind:user.role==="WAREHOUSE"?"WAREHOUSE":"OFFICE",issuedBy:p.userId,expiresAt});
 await record(ctx,user.id,"USER_SETUP_ISSUED",null,{expiresAt:expiresAt.toISOString(),kind:user.role==="WAREHOUSE"?"WAREHOUSE":"OFFICE"});
 return `${webauthnConfig().origin}/login?setup=1#setup=${token}`;
}
async function validateFields(db:DbExecutor,input:Extract<Command,{action:"CREATE"|"EDIT"}>) {
 if(input.role!=="WAREHOUSE"&&!input.email||input.role==="WAREHOUSE"&&(input.email!==null||input.permissions.length||input.entityIds.length!==1)
  ||input.role==="CATALOG_REVIEWER"&&(input.permissions.length||input.entityIds.length)
  ||input.role!=="ADMIN"&&input.role!=="CATALOG_REVIEWER"&&!input.entityIds.length||new Set(input.entityIds).size!==input.entityIds.length||new Set(input.permissions).size!==input.permissions.length)throw new AppError("VALIDATION_ERROR","Invalid user role, email or memberships.");
 if(input.entityIds.length&&(await db.select({id:legalEntities.id}).from(legalEntities).where(and(inArray(legalEntities.id,input.entityIds),eq(legalEntities.active,true)))).length!==input.entityIds.length)throw new AppError("VALIDATION_ERROR","Active legal entity memberships required.");
 if(input.email){const existing=await db.select({id:users.id}).from(users).where(eq(users.email,input.email));if(existing.some(u=>input.action==="CREATE"||u.id!==input.id))throw new AppError("CONFLICT","Email is already assigned.");}
}
async function memberships(ctx:DomainTransactionContext,p:AuthenticatedPrincipal,userId:string,input:Extract<Command,{action:"CREATE"|"EDIT"}>) {
 const old=await ctx.tx.select().from(userEntityMemberships).where(eq(userEntityMemberships.userId,userId));
 for(const row of old)if(!input.entityIds.includes(row.legalEntityId))await ctx.tx.delete(userEntityMemberships).where(and(eq(userEntityMemberships.userId,userId),eq(userEntityMemberships.legalEntityId,row.legalEntityId)));
 if(input.entityIds.length)await ctx.tx.insert(userEntityMemberships).values(input.entityIds.map(legalEntityId=>({userId,legalEntityId}))).onConflictDoNothing();
 await ctx.tx.delete(userPermissions).where(eq(userPermissions.userId,userId));
 if(input.permissions.length)await ctx.tx.insert(userPermissions).values(input.permissions.map(permissionKey=>({userId,permissionKey,grantedBy:p.userId})));
}
/** Raw setup tokens are returned once, never included in persisted idempotency receipts. */
export async function manageUser(db:DbExecutor,p:AuthenticatedPrincipal,key:string,raw:unknown) {
 const parsed=userManagementCommand.safeParse(raw);if(!parsed.success||!id.safeParse(key).success)throw new AppError("VALIDATION_ERROR","Invalid user management command.");
 await admin(db,p);let setupUrl:string|undefined;
 const result=await executeIdempotent(db,{scope:`users:${p.userId}:${p.sessionId}`,idempotencyKey:key,payload:parsed.data},tx=>withDomainTransaction(tx,{userId:p.userId},async ctx=>{
  await authorizeUserManagement(ctx.tx,p);const input=parsed.data;
  if(input.action==="TTL") {
   if(!Number.isFinite(new Date(Date.now()+input.hours*3600000).getTime()))throw new AppError("VALIDATION_ERROR","Invalid lifetime.");
   const before=await setupLinkHours(ctx.tx);
   await ctx.tx.insert(systemSettings).values({key:"user_setup_link_hours",valueJson:{hours:input.hours},description:"One-time user setup expiry in hours",updatedBy:p.userId}).onConflictDoUpdate({target:systemSettings.key,set:{valueJson:{hours:input.hours},updatedBy:p.userId,updatedAt:new Date()}});
   await record(ctx,p.userId,"USER_SETUP_LIFETIME_CHANGED",{hours:before},{hours:input.hours});return {status:200,body:{ok:true,id:p.userId}};
  }
  if(input.action==="CREATE") {
   await validateFields(ctx.tx,input);const userId=createUuidV7();
   const [user]=await ctx.tx.insert(users).values({id:userId,fullName:input.fullName,email:input.email,role:input.role,totpEnrollmentRequired:input.role!=="WAREHOUSE"}).returning();
   await memberships(ctx,p,userId,input);await record(ctx,userId,"USER_CREATED",null,{role:input.role,entityIds:input.entityIds,permissions:input.permissions,setupRequired:true});
   setupUrl=await issue(ctx,p,user!);return {status:201,body:{ok:true,id:userId}};
  }
  const [user]=await ctx.tx.select().from(users).where(eq(users.id,input.id)).for("update");if(!user)throw new AppError("NOT_FOUND","User not found.");
  if(input.action==="EDIT") {
   if(user.id===p.userId&&input.role!==user.role)throw forbidden();await validateFields(ctx.tx,input);
   const oldEntities=(await ctx.tx.select().from(userEntityMemberships).where(eq(userEntityMemberships.userId,user.id))).map(m=>m.legalEntityId);
   const oldPermissions=(await ctx.tx.select().from(userPermissions).where(eq(userPermissions.userId,user.id))).map(m=>m.permissionKey);
   const before={role:user.role,entityIds:oldEntities,permissions:oldPermissions},after={role:input.role,entityIds:input.entityIds,permissions:input.permissions,nameChanged:user.fullName!==input.fullName,emailChanged:user.email!==input.email};
   const changedKind=(user.role==="WAREHOUSE")!==(input.role==="WAREHOUSE")
     || (user.role==="CATALOG_REVIEWER")!==(input.role==="CATALOG_REVIEWER");
   const changedScope=changedKind||user.role!==input.role||user.email!==input.email||JSON.stringify([...oldEntities].sort())!==JSON.stringify([...input.entityIds].sort())||JSON.stringify([...oldPermissions].sort())!==JSON.stringify([...input.permissions].sort());
   if(changedScope)await revokeAccess(ctx,user.id);
   const [updated]=await ctx.tx.update(users).set({fullName:input.fullName,email:input.email,role:input.role,updatedAt:new Date(),...(changedKind?{passwordHash:null,pinHash:null,totpSecretEncrypted:null,totpEnabled:false,totpEnrollmentRequired:input.role!=="WAREHOUSE"}: {})}).where(eq(users.id,user.id)).returning();
   await memberships(ctx,p,user.id,input);await record(ctx,user.id,"USER_ACCESS_CHANGED",before,after);
   if(changedKind){await ctx.tx.update(userPasskeys).set({revokedAt:new Date()}).where(and(eq(userPasskeys.userId,user.id),isNull(userPasskeys.revokedAt)));setupUrl=await issue(ctx,p,updated!);}
  } else if(input.action==="ACTIVE") {
   if(user.id===p.userId&&!input.active)throw forbidden();
   if(!input.active)await revokeAccess(ctx,user.id);
   await ctx.tx.update(users).set({active:input.active,updatedAt:new Date()}).where(eq(users.id,user.id));
   await record(ctx,user.id,"USER_ACTIVE_CHANGED",{active:user.active},{active:input.active});
  } else {
   if(input.action==="ISSUE"&&(user.passwordHash||user.pinHash))throw new AppError("PRECONDITION_FAILED","Use credential reset for an enrolled user.");
   if(input.action==="RESET") {
    if(user.id===p.userId)throw new AppError("PRECONDITION_FAILED","Use account security for your own credentials.");
    await revokeAccess(ctx,user.id);
    await ctx.tx.update(userPasskeys).set({revokedAt:new Date()}).where(and(eq(userPasskeys.userId,user.id),isNull(userPasskeys.revokedAt)));
    await ctx.tx.update(users).set({passwordHash:null,pinHash:null,totpSecretEncrypted:null,totpEnabled:false,totpEnrollmentRequired:user.role!=="WAREHOUSE",updatedAt:new Date()}).where(eq(users.id,user.id));
    await record(ctx,user.id,"USER_CREDENTIAL_RESET",null,{setupRequired:true,passkeysRevoked:true});
   }
   setupUrl=await issue(ctx,p,user);
  }
  return {status:200,body:{ok:true,id:user.id}};
 }));
 return {...result,body:{...result.body,...(setupUrl?{setupUrl}: {})}};
}
function tokenHash(raw:string) {if(!/^[A-Za-z0-9_-]{43}$/.test(raw))throw new AppError("UNAUTHORIZED","Invalid setup link.");return sha256Hex(raw);}
async function setup(db:DbExecutor,raw:string,lock=false) {
 const hash=tokenHash(raw),[initial]=await db.select().from(userSetupLinks).where(eq(userSetupLinks.tokenHash,hash));
 if(!initial)throw new AppError("UNAUTHORIZED","Invalid setup link.");
 // Same user -> link order as management; concurrent consumption cannot race a reset/deactivation.
 const userQuery=db.select().from(users).where(eq(users.id,initial.userId));const [user]=await(lock?userQuery.for("update"):userQuery);
 const linkQuery=db.select().from(userSetupLinks).where(eq(userSetupLinks.id,initial.id));const [link]=await(lock?linkQuery.for("update"):linkQuery);
 if(!user?.active||!link||link.usedAt||link.revokedAt||link.expiresAt<=new Date()||(user.role==="WAREHOUSE")!==(link.kind==="WAREHOUSE"))throw new AppError("UNAUTHORIZED","Invalid setup link.");
 return {user,link};
}
export async function inspectUserSetup(db:DbExecutor,raw:string) {const {user,link}=await setup(db,raw);return {kind:link.kind,email:user.email,fullName:user.fullName};}
export async function completeUserSetup(db:DbExecutor,raw:string,secret:string,rawDeviceToken?:string) {
 const initial=await setup(db,raw),office=initial.link.kind==="OFFICE";
 if(office?!officePassword.safeParse(secret).success:!/^\d{4,6}$/.test(secret))throw new AppError("VALIDATION_ERROR","Invalid setup credential.");
 const hash=await hashSecret(secret);
 // Authentication ceremony: token is the single-use proof; no secret/session/enrollment response is persisted.
 return withDomainTransaction(db,{userId:initial.user.id},async ctx=>{
  const {user,link}=await setup(ctx.tx,raw,true);if(office!==(link.kind==="OFFICE"))throw new AppError("UNAUTHORIZED","Invalid setup link.");
  if(!office){const [device]=rawDeviceToken?await ctx.tx.select().from(registeredDevices).where(and(eq(registeredDevices.deviceTokenHash,sha256Hex(rawDeviceToken)),eq(registeredDevices.active,true),isNull(registeredDevices.revokedAt))).for("update"):[];if(!device)throw new AppError("FORBIDDEN","An active registered warehouse device is required.");}
  await ctx.tx.update(users).set(office?{passwordHash:hash,pinHash:null,totpSecretEncrypted:null,totpEnabled:false,totpEnrollmentRequired:true,updatedAt:new Date()}:{pinHash:hash,passwordHash:null,totpEnabled:false,totpEnrollmentRequired:false,updatedAt:new Date()}).where(eq(users.id,user.id));
  await ctx.tx.update(userSetupLinks).set({usedAt:new Date()}).where(eq(userSetupLinks.id,link.id));
  await record(ctx,user.id,"USER_SETUP_COMPLETED",null,{kind:link.kind,totpEnrollmentRequired:office});
  return {ok:true,kind:link.kind,email:user.email};
 });
}
