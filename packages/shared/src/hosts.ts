/** Use the actual Host, never X-Forwarded-Host, as the virtual-host boundary. */
export function storefrontApiHost(env:NodeJS.ProcessEnv=process.env) {
  const raw=env.KHIDI_API_HOST?.trim() || (env.NODE_ENV==="production" ? "api.khidi.app" : "api.localhost:3100");
  const url=new URL("http://"+raw);
  if(url.host!==raw.toLowerCase() || url.username || url.password || url.pathname!=="/" || url.search || url.hash) throw new Error("Invalid KHIDI_API_HOST.");
  if(env.NODE_ENV==="production" && raw!=="api.khidi.app") throw new Error("Production API host must be api.khidi.app.");
  return raw.toLowerCase();
}
export function requestHost(request:Request) {return (request.headers.get("host")??new URL(request.url).host).toLowerCase();}
export function isStorefrontApiHost(request:Request,env:NodeJS.ProcessEnv=process.env) {return requestHost(request)===storefrontApiHost(env);}
