import { expect,it } from "vitest";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { getDb } from "./client.ts";
import { getPostgresError } from "./postgres-error.ts";
it("recovers a real PostgreSQL SQLSTATE through Drizzle's cause without returning query parameters",async()=>{
 let caught:unknown;try{await getDb().execute(sql`SELECT 1/0`);}catch(error){caught=error;}
 expect(getPostgresError(caught)).toEqual({code:"22012",message:"division by zero"});
 expect(getPostgresError(new Error("ordinary error"))).toBeUndefined();
});
it("quotes an attacker-controlled SQL identifier as one identifier without executing its delimiters",async()=>{
 const name='result"; SELECT pg_sleep(10); --';
 const query=sql`SELECT 7 AS ${sql.identifier(name)}`;
 expect(new PgDialect().sqlToQuery(query).sql).toBe('SELECT 7 AS "result""; SELECT pg_sleep(10); --"');
 const result=await getDb().execute(query);expect(result.rows).toEqual([{[name]:7}]);
});
