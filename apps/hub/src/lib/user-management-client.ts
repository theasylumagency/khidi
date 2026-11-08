/** A lost response retries the same intent; an acknowledged operation releases its key. */
export function createUserCommandSender(transport:typeof fetch=fetch) {
 let pending:{body:string;key:string}|undefined;
 return async(input:unknown)=>{
  const body=JSON.stringify(input);
  if(!pending||pending.body!==body)pending={body,key:crypto.randomUUID()};
  const response=await transport("/api/users",{method:"POST",credentials:"same-origin",cache:"no-store",redirect:"error",headers:{"Content-Type":"application/json","Idempotency-Key":pending.key},body});
  const result=await response.json() as {error?:string;setupUrl?:string;id?:string};
  if(response.ok)pending=undefined;
  return {response,body:result};
 };
}
