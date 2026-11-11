import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile,writeFile,mkdtemp,unlink,rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeDrillBuckets,copyDrillObjects } from "../packages/media/src/recovery-copy.ts";
import { verifyRestore } from "./verify-restore.ts";
const root=fileURLToPath(new URL("../",import.meta.url));
const project="khidi-m11-restore-"+randomBytes(6).toString("hex"),compose=["compose","-p",project,"-f",path.join(root,"ops/compose.restore-test.yml")];
const secret=()=>randomBytes(32).toString("hex");
const generated={KHIDI_DRILL_MIGRATOR_PASSWORD:secret(),KHIDI_DRILL_APP_PASSWORD:secret(),KHIDI_DRILL_CIPHER:secret(),KHIDI_DRILL_STORAGE_USER:"drill-"+randomBytes(8).toString("hex"),KHIDI_DRILL_STORAGE_PASSWORD:secret()};
const dockerEnv={...process.env,...generated};
function run(program:string,args:string[],env:NodeJS.ProcessEnv=dockerEnv) {
 return new Promise<string>((resolve,reject)=>{const child=spawn(program,args,{cwd:root,env,shell:false,windowsHide:true,stdio:["ignore","pipe","pipe"]});let out="",stderr="";child.stdout.on("data",chunk=>{out+=chunk;if(out.length>2000000)child.kill();});child.stderr.on("data",chunk=>{if(stderr.length<32768)stderr+=chunk;});child.on("error",()=>reject(new Error("Restore drill command unavailable: "+path.basename(program))));child.on("exit",code=>code===0?resolve(out.trim()):reject(new Error(`Restore drill command failed: ${path.basename(program)} (exit ${code}).`+(program==="docker"&&args.includes("up")?" "+stderr:" "+(stderr.split("\n").find(line=>/(?:[A-Za-z]*Error|error)(?: \[.*?\])?:/.test(line)&&!line.includes("Failed query:")&&!line.includes("console."))??"")))));});
}
const docker=(args:string[])=>run("docker",args);
const stage=(message:string)=>console.log("Khidi restore drill: "+message);
function childEnvironment(extra:NodeJS.ProcessEnv) {
 const clean:NodeJS.ProcessEnv={};for(const key of ["PATH","Path","SystemRoot","SYSTEMROOT","ComSpec","PATHEXT","TEMP","TMP","TMPDIR","HOME","USERPROFILE","APPDATA","LOCALAPPDATA"])if(process.env[key])clean[key]=process.env[key];
 return {...clean,NODE_ENV:"test",AI_PROVIDER:"disabled",...extra};
}
async function port(service:string,internal:number) {const value=await docker([...compose,"port",service,String(internal)]);if(!/^127\.0\.0\.1:\d+$/.test(value))throw new Error("SAFETY: Docker did not allocate an isolated loopback port.");return value.split(":")[1]!;}
const reportPath=path.join(root,"ops",".restore-test-"+project+".json");
let directory:string|undefined,started=false;
try {
 if(process.env.NODE_ENV==="production")throw new Error("SAFETY: local synthetic restore drill is forbidden in production.");
 if(process.argv.length!==2)throw new Error("Restore drill takes no arguments or existing database URLs.");
 stage("creating new project-scoped PostgreSQL and two MinIO instances");started=true;
 await docker([...compose,"up","-d","--wait","--wait-timeout","120"]);
 const container=await docker([...compose,"ps","-q","restore-source"]);if(!/^[a-f0-9]{12,64}$/.test(container))throw new Error("Unexpected restore container identity.");
 const sourcePort=await port("restore-source",5432),targetPort=await port("restore-source",5433);
 const database=(role:string,password:string,port:string,name="khidi_restore_test")=>`postgres://${role}:${password}@127.0.0.1:${port}/${name}`;
 const sourceUrl=database("hub_migrator",generated.KHIDI_DRILL_MIGRATOR_PASSWORD,sourcePort),targetUrl=database("hub_migrator",generated.KHIDI_DRILL_MIGRATOR_PASSWORD,targetPort);
 const media=(port:string):NodeJS.ProcessEnv=>({NODE_ENV:"test",MEDIA_STORAGE_DRIVER:"s3",MEDIA_S3_ENDPOINT:"http://127.0.0.1:"+port,MEDIA_S3_REGION:"us-east-1",MEDIA_S3_FORCE_PATH_STYLE:"true",MEDIA_PRIVATE_BUCKET:"khidi-drill-private",MEDIA_PUBLIC_BUCKET:"khidi-drill-public",MEDIA_S3_ACCESS_KEY_ID:generated.KHIDI_DRILL_STORAGE_USER,MEDIA_S3_SECRET_ACCESS_KEY:generated.KHIDI_DRILL_STORAGE_PASSWORD});
 const sourceMedia=media(await port("media-source",9000)),targetMedia=media(await port("media-target",9000));
 await initializeDrillBuckets(sourceMedia);await initializeDrillBuckets(targetMedia);
 directory=await mkdtemp(path.join(tmpdir(),"khidi-m11-restore-"));const roleScript=path.join(directory,"init-roles.sh");
 await writeFile(roleScript,(await readFile(path.join(root,"docker/postgres/init-roles.sh"),"utf8")).replaceAll("\r\n","\n"),{flag:"wx",mode:0o600});
 const backupConfig=path.join(directory,"pgbackrest.conf");await writeFile(backupConfig,(await readFile(path.join(root,"ops/pgbackrest/test.conf"),"utf8")).replaceAll("\r\n","\n"),{flag:"wx",mode:0o644});
 await docker(["cp",backupConfig,container+":/etc/pgbackrest/pgbackrest.conf"]);
 await docker(["cp",roleScript,container+":/tmp/m11-init-roles.sh"]);await docker(["exec",container,"sh","/tmp/m11-init-roles.sh"]);
 await docker(["exec",container,"mkdir","-p","/var/lib/postgresql/restore-target/recovered","/var/lib/pgbackrest"]);
 await docker(["exec",container,"chown","postgres:postgres","/var/lib/postgresql/restore-target","/var/lib/postgresql/restore-target/recovered","/var/lib/pgbackrest"]);
 await docker(["exec",container,"chmod","0700","/var/lib/postgresql/restore-target/recovered"]);
 stage("building synthetic source only; no shared database configuration is read");
 const sourceEnv=childEnvironment({...sourceMedia,DATABASE_URL:database("hub_app",generated.KHIDI_DRILL_APP_PASSWORD,sourcePort),DATABASE_MIGRATOR_URL:sourceUrl,KHIDI_SYNTHETIC_RESTORE_SOURCE:"1"});
 const fixture=await run(process.execPath,["--import","tsx","ops/restore-drill-fixture.ts"],sourceEnv);if(!fixture.includes('"syntheticSourceReady":true'))throw new Error("Synthetic source proof missing.");
 stage("recovering immutable object storage into a different MinIO instance");
 const objects=await copyDrillObjects(sourceMedia,targetMedia);if(!objects.some(o=>o.key.startsWith("raw/"))||!objects.some(o=>o.key.startsWith("evidence/"))||!objects.some(o=>o.key.startsWith("reports/")))throw new Error("Raw, evidence and report recovery proof required.");
 await docker(["exec","--user","postgres",container,"pgbackrest","--config=/etc/pgbackrest/pgbackrest.conf","--stanza=khidi","stanza-create"]);
 stage("taking encrypted pgBackRest backup, restoring, checking all tables/hashes, then testing a recovered clone");
 const env:NodeJS.ProcessEnv=childEnvironment({...sourceMedia,SOURCE_WRITERS_STOPPED:"yes",SOURCE_MIGRATOR_URL:sourceUrl,RESTORE_MIGRATOR_URL:targetUrl,RESTORE_APP_URL:database("hub_app",generated.KHIDI_DRILL_APP_PASSWORD,targetPort),
  RESTORE_TEST_MIGRATOR_URL:database("hub_migrator",generated.KHIDI_DRILL_MIGRATOR_PASSWORD,targetPort,"khidi_recovered_e2e_test"),RESTORE_TEST_APP_URL:database("hub_app",generated.KHIDI_DRILL_APP_PASSWORD,targetPort,"khidi_recovered_e2e_test"),
  OPS_DOCKER_CONTAINER:container,PGBACKREST_CONFIG:"/etc/pgbackrest/pgbackrest.conf",SOURCE_PGDATA:"/var/lib/postgresql/18/khidi",RESTORE_ROOT:"/var/lib/postgresql/restore-target",RESTORE_PGDATA:"/var/lib/postgresql/restore-target/recovered",RESTORE_PORT:"5433",RESTORE_REPORT:reportPath});
 for(const [key,value]of Object.entries(targetMedia))if(key.startsWith("MEDIA_"))env["RESTORE_"+key]=value;
 await verifyRestore(env);
 const report=JSON.parse(await readFile(reportPath,"utf8"));
 const summary={passed:true,postgres:"18.4",backup:"pgBackRest 2.60.0 encrypted full + WAL",tables:Object.keys(report.source.rowCounts).length,objects:objects.length,privateReferences:report.privateReferencesVerified,rawSamples:report.sampledRawFiles,inventoryVerified:report.inventoryVerified,e2e:report.testsPassed,recoveredUnchanged:report.recoveredUnchanged,report:reportPath};
 await writeFile(reportPath,JSON.stringify({...report,objectManifest:objects,summary},null,2),{mode:0o600});console.log(JSON.stringify(summary));
}catch(error) {
 console.error(error instanceof Error?error.message:"Khidi local restore drill failed.");process.exitCode=1;
}finally {
 if(directory){const resolved=path.resolve(directory);if(path.dirname(resolved)!==path.resolve(tmpdir())||!path.basename(resolved).startsWith("khidi-m11-restore-"))throw new Error("Unsafe temporary cleanup path.");await unlink(path.join(resolved,"init-roles.sh"));await unlink(path.join(resolved,"pgbackrest.conf"));await rmdir(resolved);}
 if(started){if(!/^khidi-m11-restore-[a-f0-9]{12}$/.test(project))throw new Error("Unsafe Docker cleanup project.");const ids=(await docker([...compose,"ps","-aq"])).split(/\s+/).filter(Boolean);for(const id of ids)if(await docker(["inspect","--format",'{{index .Config.Labels "com.docker.compose.project"}}',id])!==project)throw new Error("Refusing to clean up an unowned container.");await docker([...compose,"down","--volumes","--remove-orphans"]);}
}
