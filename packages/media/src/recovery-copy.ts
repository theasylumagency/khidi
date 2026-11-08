import { CreateBucketCommand,PutBucketVersioningCommand,PutObjectLockConfigurationCommand,ListObjectsV2Command,GetObjectCommand,PutObjectCommand } from "@aws-sdk/client-s3";
import { createMediaS3Client } from "./storage-config.ts";
import { digest,checkDigest } from "./storage.ts";
function local(env:NodeJS.ProcessEnv) {
 const url=new URL(env.MEDIA_S3_ENDPOINT??"");
 if(env.NODE_ENV!=="test"||url.protocol!=="http:"||!["127.0.0.1","localhost","[::1]"].includes(url.hostname)||!url.port||!env.MEDIA_PRIVATE_BUCKET||!env.MEDIA_PUBLIC_BUCKET||env.MEDIA_PRIVATE_BUCKET===env.MEDIA_PUBLIC_BUCKET)throw new Error("SAFETY: recovery-copy is for isolated loopback MinIO fixtures only.");
 return [env.MEDIA_PRIVATE_BUCKET,env.MEDIA_PUBLIC_BUCKET];
}
export async function initializeDrillBuckets(env:NodeJS.ProcessEnv) {
 const buckets=local(env),client=createMediaS3Client(env);
 try {for(const [i,Bucket]of buckets.entries()) {
  await client.send(new CreateBucketCommand({Bucket,ObjectLockEnabledForBucket:i===0}));
  await client.send(new PutBucketVersioningCommand({Bucket,VersioningConfiguration:{Status:"Enabled"}}));
  if(i===0)await client.send(new PutObjectLockConfigurationCommand({Bucket,ObjectLockConfiguration:{ObjectLockEnabled:"Enabled",Rule:{DefaultRetention:{Mode:"COMPLIANCE",Days:30}}}}));
 }}finally{client.destroy();}
}
/** Empty local target only. Private versions use immutable keys; public copies are disposable. */
export async function copyDrillObjects(sourceEnv:NodeJS.ProcessEnv,targetEnv:NodeJS.ProcessEnv) {
 const sourceBuckets=local(sourceEnv),targetBuckets=local(targetEnv);if(sourceEnv.MEDIA_S3_ENDPOINT===targetEnv.MEDIA_S3_ENDPOINT)throw new Error("SAFETY: separate MinIO endpoints required.");
 const source=createMediaS3Client(sourceEnv),target=createMediaS3Client(targetEnv),manifest:{area:string;key:string;sha256:string;bytes:number}[]=[];
 try {
  for(const Bucket of targetBuckets)if((await target.send(new ListObjectsV2Command({Bucket,MaxKeys:1}))).KeyCount)throw new Error("Restore object target must be empty.");
  for(const [i,Bucket]of sourceBuckets.entries()) {
   let token:string|undefined;
   do {const page=await source.send(new ListObjectsV2Command({Bucket,ContinuationToken:token}));
    for(const object of page.Contents??[]) {
     const original=await source.send(new GetObjectCommand({Bucket,Key:object.Key}));if(!original.Body)throw new Error("Missing source object body.");
     const bytes=await original.Body.transformToByteArray(),sha256=digest(bytes);if(original.Metadata?.sha256)checkDigest(bytes,original.Metadata.sha256);
     await target.send(new PutObjectCommand({Bucket:targetBuckets[i]!,Key:object.Key,Body:bytes,ContentType:original.ContentType,Metadata:{...original.Metadata,sha256},IfNoneMatch:"*"}));
     const restored=await target.send(new GetObjectCommand({Bucket:targetBuckets[i]!,Key:object.Key}));if(!restored.Body)throw new Error("Missing recovered object body.");
     const copy=await restored.Body.transformToByteArray();checkDigest(copy,sha256);if(copy.length!==bytes.length)throw new Error("Recovered object size mismatch.");
     manifest.push({area:i===0?"private":"public",key:object.Key!,sha256,bytes:bytes.length});
    }
    token=page.IsTruncated?page.NextContinuationToken:undefined;
   }while(token);
  }
  return manifest;
 }finally{source.destroy();target.destroy();}
}
