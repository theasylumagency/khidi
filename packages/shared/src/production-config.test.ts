import { createECDH,randomBytes } from "node:crypto";
import { expect,it } from "vitest";
import { assertProductionConfiguration } from "./production-config.ts";
function valid():NodeJS.ProcessEnv {
 const key=createECDH("prime256v1");key.generateKeys();
 return {NODE_ENV:"production",DATABASE_URL:"postgres://hub_app:synthetic-production-fixture@localhost/khidi_test",
 DATABASE_MIGRATOR_URL:"postgres://hub_migrator:synthetic-production-fixture@localhost/khidi_test",
 HUB_TOTP_ENCRYPTION_KEY:randomBytes(32).toString("hex"),MEDIA_SIGNING_SECRET:randomBytes(32).toString("hex"),KHIDI_PROXY_TOKEN:randomBytes(32).toString("hex"),
 WEBAUTHN_RP_ID:"app.khidi.app",WEBAUTHN_ORIGIN:"https://app.khidi.app",KHIDI_API_HOST:"api.khidi.app",
 NEXT_PUBLIC_VAPID_PUBLIC_KEY:key.getPublicKey().toString("base64url"),VAPID_PRIVATE_KEY:key.getPrivateKey().toString("base64url"),VAPID_SUBJECT:"https://app.khidi.app",
 MEDIA_STORAGE_DRIVER:"s3",MEDIA_S3_ENDPOINT:"https://storage.internal",MEDIA_S3_REGION:"eu-central-1",MEDIA_PRIVATE_BUCKET:"khidi-private",MEDIA_PUBLIC_BUCKET:"khidi-public",
 MEDIA_S3_ACCESS_KEY_ID:"synthetic-production-fixture",MEDIA_S3_SECRET_ACCESS_KEY:randomBytes(32).toString("hex"),
 BACKUP_REPOSITORY_URL:"s3://khidi-backups/postgres",BACKUP_RETENTION_DAYS:"30",BACKUP_ENCRYPTION:"aes-256-cbc",PG_WAL_ARCHIVING:"on",BACKUP_SCHEDULE:"0 2 * * *",PGBACKREST_CONFIG:"/etc/pgbackrest/pgbackrest.conf"};
}
it("validates every required deployment setting without connecting or printing values",()=>{
 const env=valid();expect(assertProductionConfiguration(env,"deployment")).toEqual({profile:"deployment"});
 for(const name of Object.keys(env)){const copy={...env};delete copy[name];expect(()=>assertProductionConfiguration(copy,"deployment"),name).toThrow("CRITICAL:");}
 const runtime={...env};delete runtime.DATABASE_MIGRATOR_URL;delete runtime.PGBACKREST_CONFIG;expect(()=>assertProductionConfiguration(runtime)).not.toThrow();
});
it("rejects wrong roles, pairing, overrides, development secrets and mismatched keys with safe errors",()=>{
 const env=valid();
 const invalid:Record<string,string>[]=[{DATABASE_URL:"broken-secret-value"},{DATABASE_URL:env.DATABASE_URL!.replace("hub_app","hub_migrator")},
 {DATABASE_MIGRATOR_URL:env.DATABASE_MIGRATOR_URL!.replace("khidi_test","other_test")},{DATABASE_URL:env.DATABASE_URL+"?host=secret-override"},
 {HUB_TOTP_ENCRYPTION_KEY:"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"},{MEDIA_SIGNING_SECRET:"khidi_media_signing_development_secret_only"},
 {KHIDI_PROXY_TOKEN:"short"},{WEBAUTHN_ORIGIN:"https://api.khidi.app"},{KHIDI_API_HOST:"app.khidi.app"},
 {MEDIA_S3_ENDPOINT:"http://storage.internal"},{MEDIA_PUBLIC_BUCKET:env.MEDIA_PRIVATE_BUCKET!},{MEDIA_S3_ACCESS_KEY_ID:"minioadmin"},
 {VAPID_PRIVATE_KEY:randomBytes(32).toString("base64url")},{BACKUP_RETENTION_DAYS:"29"},{BACKUP_ENCRYPTION:"none"},{PG_WAL_ARCHIVING:"off"}];
 for(const change of invalid){try{assertProductionConfiguration({...env,...change},"deployment");expect.fail(JSON.stringify(Object.keys(change)));}catch(error){expect((error as Error).message).toMatch(/^CRITICAL:/);expect((error as Error).message).not.toContain(Object.values(change)[0]);}}
});
