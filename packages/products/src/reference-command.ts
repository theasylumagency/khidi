/** Parse before opening any database connection. Apply requires an explicit database-name assertion. */
export function referenceCommand(args:string[],env:NodeJS.ProcessEnv) {
 if(args.some(arg=>arg!=="--apply"&&!arg.startsWith("--expect-database="))||new Set(args).size!==args.length||args.filter(arg=>arg.startsWith("--expect-database=")).length>1)throw new Error("Use --apply --expect-database=<name>, or no arguments for preview.");
 let url:URL;try{url=new URL(env.DATABASE_URL??"");}catch{throw new Error("SAFETY: explicit DATABASE_URL is required.");}
 if(!["postgres:","postgresql:"].includes(url.protocol)||!url.hostname||!/^\/[^/]+$/.test(url.pathname)||url.hash)throw new Error("SAFETY: a PostgreSQL database URL is required.");
 for(const key of url.searchParams.keys())if(!["sslmode","application_name","connect_timeout"].includes(key))throw new Error("SAFETY: connection overrides are forbidden.");
 const name=decodeURIComponent(url.pathname.slice(1)),apply=args.includes("--apply"),expected=args.find(arg=>arg.startsWith("--expect-database="))?.slice(18);
 if(apply&&expected!==name)throw new Error("SAFETY: --expect-database must match the explicit target database name.");
 return {apply,database:name};
}
