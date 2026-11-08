/** Drizzle wraps driver errors in cause. Inspect SQLSTATE internally, never expose query/params. */
export function getPostgresError(error:unknown):{code:string;message:string;constraint?:string}|undefined {
 const seen=new Set<object>();let current=error;
 for(let depth=0;depth<8&&current&&typeof current==="object"&&!seen.has(current);depth++) {
  seen.add(current);const value=current as {code?:unknown;message?:unknown;constraint?:unknown;cause?:unknown};
  if(typeof value.code==="string"&&/^[0-9A-Z]{5}$/.test(value.code)&&typeof value.message==="string")return {code:value.code,message:value.message,...(typeof value.constraint==="string"?{constraint:value.constraint}:{})};
  current=value.cause;
 }
 return undefined;
}
