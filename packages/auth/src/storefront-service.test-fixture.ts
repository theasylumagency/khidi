import { users, type DbExecutor } from "@khidi/db";
import { createUuidV7 } from "@khidi/shared";
import { generateTotpSecret, generateCurrentTotpToken, hashSecret } from "./credentials.ts";
import { loginOfficeUser } from "./index.ts";
export async function serviceAdminFixture(db:DbExecutor) {
  return (await serviceAdminSessionFixture(db)).principal;
}
export async function serviceAdminSessionFixture(db:DbExecutor) {
  const email="api-"+createUuidV7()+"@example.test",password="Synthetic API fixture #2026",totp=generateTotpSecret(email);
  await db.insert(users).values({id:createUuidV7(),email,fullName:"API fixture",role:"ADMIN",passwordHash:await hashSecret(password),
    totpSecretEncrypted:totp.encryptedSecret,totpEnabled:true,totpEverEnabled:true});
  return loginOfficeUser(db,{email,password,totpCode:generateCurrentTotpToken(totp.base32Secret)});
}
