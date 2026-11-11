import { createECDH } from "node:crypto";

function invalid(name:string):never { throw new Error(`CRITICAL: Invalid or missing production configuration: ${name}.`); }
const development=/(?:development|_dev_password|khidi_(?:minio|runtime)_dev_password|change[-_ ]?me|replace[-_ ]?me|example|placeholder)/i;
function required(env:NodeJS.ProcessEnv,name:string) {const value=env[name]?.trim();if(!value||development.test(value))invalid(name);return value;}
function database(env:NodeJS.ProcessEnv,name:string,role:string) {
 try {
  const url=new URL(required(env,name));
  if(!["postgres:","postgresql:"].includes(url.protocol)||!url.hostname||url.hash||!/^\/[^/]+$/.test(url.pathname)
   ||decodeURIComponent(url.username)!==role||!decodeURIComponent(url.password)||Buffer.byteLength(decodeURIComponent(url.pathname.slice(1)))>63)invalid(name);
  for(const key of url.searchParams.keys())if(!["sslmode","application_name","connect_timeout"].includes(key))invalid(name);
  if(url.searchParams.has("sslmode")&&!['require','verify-ca','verify-full','disable'].includes(url.searchParams.get('sslmode')!))invalid(name);
  return url;
 } catch {return invalid(name);}
}
/** Pure preflight: no clients, network, credentials in errors, or claims about live backup health. */
export function assertProductionConfiguration(env:NodeJS.ProcessEnv=process.env,profile:"runtime"|"deployment"="runtime") {
 if(env.NODE_ENV!=="production")invalid("NODE_ENV=production");
 const app=database(env,"DATABASE_URL","hub_app");
 if(profile==="deployment"||env.DATABASE_MIGRATOR_URL) {
  const migrator=database(env,"DATABASE_MIGRATOR_URL","hub_migrator");
  if(migrator.hostname!==app.hostname||migrator.port!==app.port||migrator.pathname!==app.pathname)invalid("database URL pairing");
 }
 const encryption=required(env,"HUB_TOTP_ENCRYPTION_KEY");
 if(!/^[a-f0-9]{64}$/i.test(encryption)||encryption.toLowerCase()==="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")invalid("HUB_TOTP_ENCRYPTION_KEY");
 for(const name of ["MEDIA_SIGNING_SECRET","KHIDI_PROXY_TOKEN"])if(required(env,name).length<32)invalid(name);
 if(env.MEDIA_SIGNING_SECRET===env.KHIDI_PROXY_TOKEN)invalid("separate signing/proxy secrets");
 if(env.WEBAUTHN_RP_ID!=="app.khidi.app"||env.WEBAUTHN_ORIGIN!=="https://app.khidi.app")invalid("WebAuthn RP/origin");
 if(env.KHIDI_API_HOST!=="api.khidi.app")invalid("KHIDI_API_HOST");
 const recent=Number(env.AUTH_RECENT_WINDOW_SECONDS??600);if(!Number.isInteger(recent)||recent<1||recent>3600)invalid("AUTH_RECENT_WINDOW_SECONDS");
 const pub=required(env,"NEXT_PUBLIC_VAPID_PUBLIC_KEY"),priv=required(env,"VAPID_PRIVATE_KEY");
 try {
  if(!/^[A-Za-z0-9_-]{87}$/.test(pub)||!/^[A-Za-z0-9_-]{43}$/.test(priv)||priv==="UUxI4O8-FbRouAevSmBQ6o18hgE4nSG3qwvJTfKc-ls")invalid("VAPID keys");
  const key=createECDH("prime256v1");key.setPrivateKey(Buffer.from(priv,"base64url"));if(key.getPublicKey().toString("base64url")!==pub)invalid("VAPID keys");
 }catch{invalid("VAPID keys");}
 if(env.VAPID_SUBJECT!=="https://app.khidi.app")invalid("VAPID_SUBJECT");
 if(env.MEDIA_STORAGE_DRIVER!=="s3")invalid("MEDIA_STORAGE_DRIVER");
 try {const endpoint=new URL(required(env,"MEDIA_S3_ENDPOINT"));if(endpoint.protocol!=="https:"||endpoint.username||endpoint.password||endpoint.search||endpoint.hash)invalid("MEDIA_S3_ENDPOINT");}catch{invalid("MEDIA_S3_ENDPOINT");}
 const privateBucket=required(env,"MEDIA_PRIVATE_BUCKET"),publicBucket=required(env,"MEDIA_PUBLIC_BUCKET");
 for(const bucket of [privateBucket,publicBucket])if(!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket))invalid("media buckets");
 if(privateBucket===publicBucket)invalid("separate media buckets");
 required(env,"MEDIA_S3_REGION");
 if(["khidi-dev","khidi-runtime","minioadmin"].includes(required(env,"MEDIA_S3_ACCESS_KEY_ID")))invalid("MEDIA_S3_ACCESS_KEY_ID");
 if(required(env,"MEDIA_S3_SECRET_ACCESS_KEY").length<20)invalid("MEDIA_S3_SECRET_ACCESS_KEY");
 // Metadata only. Backup cipher/IAM secrets and migrator credentials belong to operations, not runtime.
 try {const repo=new URL(required(env,"BACKUP_REPOSITORY_URL"));if(repo.protocol!=="s3:"||!repo.hostname||repo.username||repo.password||repo.search||repo.hash)invalid("BACKUP_REPOSITORY_URL");}catch{invalid("BACKUP_REPOSITORY_URL");}
 const retention=Number(env.BACKUP_RETENTION_DAYS);if(!Number.isSafeInteger(retention)||retention<30)invalid("BACKUP_RETENTION_DAYS");
 if(env.BACKUP_ENCRYPTION!=="aes-256-cbc"||env.PG_WAL_ARCHIVING!=="on")invalid("backup encryption/WAL configuration");
 if(!/^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/.test(required(env,"BACKUP_SCHEDULE")))invalid("BACKUP_SCHEDULE");
 if(profile==="deployment")required(env,"PGBACKREST_CONFIG");
 return {profile};
}
