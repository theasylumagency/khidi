import { afterEach,expect,it,vi } from "vitest";
import { and,eq,ne,sql } from "drizzle-orm";
import { getDb,users,legalEntities,userSetupLinks,sessions,userPasskeys,pushSubscriptions,auditLogs,outboxEvents,idempotencyKeys,userEntityMemberships,userPermissions } from "@khidi/db";
import { createUuidV7,sha256Hex } from "@khidi/shared";
import { serviceAdminSessionFixture } from "./storefront-service.test-fixture.ts";
import { manageUser,completeUserSetup,inspectUserSetup,setupLinkHours } from "./user-management.ts";
import { loginOfficeUser,loginWithWarehousePin,registerWarehouseDevice,verifySessionToken,generateCurrentTotpToken } from "./index.ts";
const password="Synthetic setup password #2026";
afterEach(()=>vi.useRealTimers());
async function fixture(){const db=getDb(),auth=await serviceAdminSessionFixture(db),[entity]=await db.select().from(legalEntities).limit(1);
 const command=(body:unknown,key=createUuidV7())=>manageUser(db,auth.principal,key,body);
 const create=async(role="OPERATOR")=>{const input={action:"CREATE",fullName:"Setup fixture",email:role==="WAREHOUSE"?null:`setup-${createUuidV7()}@example.test`,role,entityIds:role==="CATALOG_REVIEWER"?[]:[entity!.id],permissions:[]};const result=await command(input);return {input,id:result.body.id,token:new URL(result.body.setupUrl!).hash.slice(7),result};};
 return {db,auth,command,create,entity:entity!};}
async function enroll(f:Awaited<ReturnType<typeof fixture>>,u:Awaited<ReturnType<Awaited<ReturnType<typeof fixture>>["create"]>>) {
 await completeUserSetup(f.db,u.token,password);let secret="";
 try{await loginOfficeUser(f.db,{email:u.input.email!,password});}catch(e){secret=((e as {details:{totpEnrollment:{base32Secret:string}}}).details.totpEnrollment.base32Secret);}
 const logged=await loginOfficeUser(f.db,{email:u.input.email!,password,totpCode:generateCurrentTotpToken(secret)});return {...logged,secret};
}
for(const role of ["ADMIN","STOCK_MANAGER","OPERATOR","ORDER_MANAGER","CATALOG_REVIEWER"])it(`creates ${role} with hashed single-use setup and mandatory TOTP, never an admin-chosen password`,async()=>{
 const f=await fixture(),u=await f.create(role);expect(await inspectUserSetup(f.db,u.token)).toMatchObject({kind:"OFFICE",email:u.input.email});
 const [link]=await f.db.select().from(userSetupLinks).where(eq(userSetupLinks.userId,u.id));expect(link!.tokenHash).toBe(sha256Hex(u.token));expect(link!.expiresAt.getTime()-link!.createdAt.getTime()).toBeGreaterThan(71*3600000);
 const before=await f.db.query.users.findFirst({where:eq(users.id,u.id)});expect(before).toMatchObject({passwordHash:null,totpEnabled:false,totpEnrollmentRequired:true});
 await expect(loginOfficeUser(f.db,{email:u.input.email!,password})).rejects.toMatchObject({code:"UNAUTHORIZED"});
 const signedIn=await enroll(f,u);await expect(completeUserSetup(f.db,u.token,password)).rejects.toMatchObject({code:"UNAUTHORIZED"});
 if(role==="CATALOG_REVIEWER"){
  expect(signedIn.principal).toMatchObject({role,entityIds:[],permissions:[]});
  await expect(f.command({...u.input,action:"EDIT",id:u.id,entityIds:[f.entity.id]})).rejects.toMatchObject({code:"VALIDATION_ERROR"});
  await expect(f.command({...u.input,action:"EDIT",id:u.id,permissions:["price.edit"]})).rejects.toMatchObject({code:"VALIDATION_ERROR"});
 }
 const rows=[await f.db.select().from(auditLogs).where(eq(auditLogs.entityId,u.id)),await f.db.select().from(outboxEvents).where(eq(outboxEvents.aggregateId,u.id)),await f.db.select().from(idempotencyKeys).where(eq(idempotencyKeys.scope,`users:${f.auth.principal.userId}:${f.auth.principal.sessionId}`))];
 expect(JSON.stringify(rows)).not.toContain(u.token);expect(JSON.stringify(rows)).not.toContain(password);expect((await f.db.query.users.findFirst({where:eq(users.id,u.id)}))!.totpEnabled).toBe(true);
});
it("replays creation metadata without persisting/recovering the raw setup link",async()=>{
 const f=await fixture(),key=createUuidV7(),input={action:"CREATE",fullName:"Replay",email:`replay-${key}@example.test`,role:"OPERATOR",entityIds:[f.entity.id],permissions:[]};
 const a=await f.command(input,key),b=await f.command(input,key);expect(b.replayed).toBe(true);expect(b.body.id).toBe(a.body.id);expect(b.body.setupUrl).toBeUndefined();
});
it("revokes old unused links on issuance; invalid, expired, revoked and reused links are refused",async()=>{
 const f=await fixture(),u=await f.create(),replacement=await f.command({action:"ISSUE",id:u.id});
 await expect(inspectUserSetup(f.db,u.token)).rejects.toMatchObject({code:"UNAUTHORIZED"});
 const token=new URL(replacement.body.setupUrl!).hash.slice(7);vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(Date.now()+73*3600000);
 await expect(completeUserSetup(f.db,token,password)).rejects.toMatchObject({code:"UNAUTHORIZED"});
 await expect(inspectUserSetup(f.db,"x".repeat(43))).rejects.toMatchObject({code:"UNAUTHORIZED"});
});
it("sets the configurable default lifetime with recent strong auth and audit",async()=>{
 const f=await fixture(),before=await setupLinkHours(f.db);try{await f.command({action:"TTL",hours:24});const u=await f.create();const [link]=await f.db.select().from(userSetupLinks).where(eq(userSetupLinks.userId,u.id));expect(link!.expiresAt.getTime()-link!.createdAt.getTime()).toBeLessThan(25*3600000);}finally{await f.command({action:"TTL",hours:before});}
});
it("warehouse setup needs an active registered device, then a personal PIN; concurrent redemption has one winner",async()=>{
 const f=await fixture(),u=await f.create("WAREHOUSE");await expect(completeUserSetup(f.db,u.token,"1234")).rejects.toMatchObject({code:"FORBIDDEN"});
 const device=await registerWarehouseDevice(f.db,f.auth.principal,{deviceName:"Synthetic setup terminal"});
 const outcomes=await Promise.allSettled([completeUserSetup(f.db,u.token,"1234",device.rawDeviceToken),completeUserSetup(f.db,u.token,"5678",device.rawDeviceToken)]);expect(outcomes.filter(r=>r.status==="fulfilled")).toHaveLength(1);
 const pin=outcomes[0]!.status==="fulfilled"?"1234":"5678";const logged=await loginWithWarehousePin(f.db,{userId:u.id,pin,rawDeviceToken:device.rawDeviceToken});expect(logged.principal.role).toBe("WAREHOUSE");
 await expect(f.command({action:"ISSUE",id:u.id})).rejects.toMatchObject({code:"PRECONDITION_FAILED"});
});
it("deactivation revokes sessions, push and pending links immediately, preserves credentials, and reactivation restores no old access",async()=>{
 const f=await fixture(),u=await f.create(),logged=await enroll(f,u);const [before]=await f.db.select().from(users).where(eq(users.id,u.id));
 await f.db.insert(userPasskeys).values({id:createUuidV7(),userId:u.id,credentialId:createUuidV7(),publicKey:"AQID",signCounter:0,transports:[],backupEligible:false,backedUp:false,displayName:"Fixture"});
 await f.db.insert(pushSubscriptions).values({id:createUuidV7(),userId:u.id,sessionId:logged.principal.sessionId!,browserDeviceId:createUuidV7(),endpointHash:sha256Hex(createUuidV7()),subscriptionEncrypted:"fixture"});
 await f.command({action:"ACTIVE",id:u.id,active:false});await expect(verifySessionToken(f.db,logged.sessionToken)).rejects.toMatchObject({code:"UNAUTHORIZED"});
 expect(await f.db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId,u.id))).toHaveLength(0);
 const [after]=await f.db.select().from(users).where(eq(users.id,u.id));expect(after!.passwordHash).toBe(before!.passwordHash);expect(after!.totpSecretEncrypted).toBe(before!.totpSecretEncrypted);
 expect((await f.db.select().from(userPasskeys).where(eq(userPasskeys.userId,u.id)))[0]!.revokedAt).toBeNull();
 await expect(loginOfficeUser(f.db,{email:u.input.email!,password,totpCode:generateCurrentTotpToken(logged.secret)})).rejects.toMatchObject({code:"UNAUTHORIZED"});
 await f.command({action:"ACTIVE",id:u.id,active:true});await expect(verifySessionToken(f.db,logged.sessionToken)).rejects.toMatchObject({code:"UNAUTHORIZED"});
 expect((await loginOfficeUser(f.db,{email:u.input.email!,password,totpCode:generateCurrentTotpToken(logged.secret)})).principal.userId).toBe(u.id);
 const pending=await f.create();await f.command({action:"ACTIVE",id:pending.id,active:false});await expect(inspectUserSetup(f.db,pending.token)).rejects.toMatchObject({code:"UNAUTHORIZED"});
});
it("credential reset revokes passkeys/sessions and requires a new password and fresh TOTP enrollment",async()=>{
 const f=await fixture(),u=await f.create(),logged=await enroll(f,u);
 await f.db.insert(userPasskeys).values({id:createUuidV7(),userId:u.id,credentialId:createUuidV7(),publicKey:"AQID",signCounter:0,transports:[],backupEligible:false,backedUp:false,displayName:"Fixture"});
 const reset=await f.command({action:"RESET",id:u.id});expect((await f.db.select().from(userPasskeys).where(eq(userPasskeys.userId,u.id)))[0]!.revokedAt).toBeTruthy();
 await expect(verifySessionToken(f.db,logged.sessionToken)).rejects.toMatchObject({code:"UNAUTHORIZED"});await expect(loginOfficeUser(f.db,{email:u.input.email!,password})).rejects.toMatchObject({code:"UNAUTHORIZED"});
 await completeUserSetup(f.db,new URL(reset.body.setupUrl!).hash.slice(7),"New synthetic password #2026");
 const [user]=await f.db.select().from(users).where(eq(users.id,u.id));expect(user).toMatchObject({totpEnrollmentRequired:true,totpEnabled:false,totpSecretEncrypted:null});
});
it("edits role, memberships and granular permissions, revokes old sessions and transitions office/warehouse via setup",async()=>{
 const f=await fixture(),u=await f.create(),logged=await enroll(f,u);
 await f.command({...u.input,action:"EDIT",id:u.id,role:"ORDER_MANAGER",permissions:["reports.view","price.edit"]});
 expect(await f.db.select().from(userPermissions).where(eq(userPermissions.userId,u.id))).toHaveLength(2);expect(await f.db.select().from(userEntityMemberships).where(eq(userEntityMemberships.userId,u.id))).toHaveLength(1);
 await expect(verifySessionToken(f.db,logged.sessionToken)).rejects.toMatchObject({code:"UNAUTHORIZED"});
 const converted=await f.command({...u.input,action:"EDIT",id:u.id,role:"WAREHOUSE",email:null,permissions:[]});expect(converted.body.setupUrl).toBeTruthy();
 expect(await inspectUserSetup(f.db,new URL(converted.body.setupUrl!).hash.slice(7))).toMatchObject({kind:"WAREHOUSE"});
 const restored=await f.command({...u.input,action:"EDIT",id:u.id});expect(await inspectUserSetup(f.db,new URL(restored.body.setupUrl!).hash.slice(7))).toMatchObject({kind:"OFFICE"});
 await expect(inspectUserSetup(f.db,new URL(converted.body.setupUrl!).hash.slice(7))).rejects.toMatchObject({code:"UNAUTHORIZED"});
 expect(await f.db.query.users.findFirst({where:eq(users.id,u.id)})).toMatchObject({role:"OPERATOR",passwordHash:null,pinHash:null,totpEnrollmentRequired:true});
});
it("denies STOCK_MANAGER/WAREHOUSE and stale ADMIN for every mutation; self demotion/deactivation are refused",async()=>{
 const f=await fixture(),u=await f.create();const commands=[u.input,{...u.input,role:"ADMIN"},{...u.input,action:"EDIT",id:u.id},{...u.input,action:"EDIT",id:u.id,role:"ADMIN"},{action:"ACTIVE",id:u.id,active:false},{action:"RESET",id:u.id},{action:"ISSUE",id:u.id},{action:"TTL",hours:48}];
 for(const role of ["STOCK_MANAGER","WAREHOUSE"] as const)for(const command of commands)await expect(manageUser(f.db,{...f.auth.principal,role},createUuidV7(),command)).rejects.toMatchObject({code:"FORBIDDEN"});
 await expect(f.command({...u.input,action:"EDIT",id:f.auth.principal.userId,role:"OPERATOR"})).rejects.toMatchObject({code:"FORBIDDEN"});
 await expect(f.command({action:"ACTIVE",id:f.auth.principal.userId,active:false})).rejects.toMatchObject({code:"FORBIDDEN"});
 await f.db.update(sessions).set({lastStrongAuthAt:new Date(Date.now()-3600000)}).where(eq(sessions.id,f.auth.principal.sessionId!));
 for(const command of commands)await expect(f.command(command)).rejects.toMatchObject({code:"RECENT_AUTH_REQUIRED"});
});
it("protects the last active ADMIN and setup history at database level without deleting accounts",async()=>{
 const f=await fixture(),u=await f.create();
 await expect(f.db.transaction(async tx=>{
  await tx.execute(sql`CREATE TEMP TABLE users (LIKE public.users INCLUDING ALL) ON COMMIT DROP`);
  await tx.insert(users).values({id:createUuidV7(),role:"ADMIN",fullName:"Temporary namespace fixture"});
  await tx.execute(sql`UPDATE public.users SET active=false WHERE role='ADMIN' AND id<>${f.auth.principal.userId}::uuid`);
  await tx.execute(sql`UPDATE public.users SET active=false WHERE id=${f.auth.principal.userId}::uuid`);
 })).rejects.toMatchObject({cause:{message:expect.stringMatching(/Last active ADMIN/)}});
 expect((await f.db.select().from(users).where(eq(users.id,f.auth.principal.userId)))[0]!.active).toBe(true);
 await expect(f.db.delete(users).where(eq(users.id,u.id))).rejects.toThrow();
 await expect(f.db.update(userSetupLinks).set({tokenHash:sha256Hex("replacement")}).where(eq(userSetupLinks.userId,u.id))).rejects.toThrow();
});
