import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { sql } from "drizzle-orm";
import { connectMigratorDatabase } from "@khidi/db";
import { createMediaStorage } from "@khidi/media/storage-config";
import { assertLocalReviewDatabase, assertSharedReviewDatabase, importReviewPilot, previewReviewImport } from "./import.ts";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { preview: { type: "boolean" }, "apply-shared": { type: "boolean" }, "expect-database": { type: "string" } }
});
const [manifest, media, admin, reviewer] = positionals;
const expected = values["expect-database"];
const shared = values["apply-shared"];

if (!manifest || !media || positionals.length > 4 || (values.preview ? admin || shared || expected !== undefined : !admin)
  || (shared ? !reviewer || !expected : expected !== undefined)) {
  throw new Error([
    "Usage:",
    "  ops:catalog-review-pilot --preview MANIFEST AUDITED_MEDIA_DIRECTORY",
    "  ops:catalog-review-pilot MANIFEST AUDITED_MEDIA_DIRECTORY ADMIN_EMAIL [REVIEWER_EMAIL]",
    "  ops:catalog-review-pilot --apply-shared --expect-database=NAME MANIFEST AUDITED_MEDIA_DIRECTORY ADMIN_EMAIL REVIEWER_EMAIL"
  ].join("\n"));
}

if (values.preview) {
  console.log(await previewReviewImport(await readFile(manifest), media));
} else {
  if (shared) assertSharedReviewDatabase(expected!);
  else assertLocalReviewDatabase();

  const manifestBytes = await readFile(manifest);
  const storage = createMediaStorage();
  const connection = connectMigratorDatabase();
  try {
    if (shared) {
      const result = await connection.db.execute<{ database: string }>(sql`SELECT current_database() AS database`);
      if (result.rows[0]?.database !== expected) throw new Error("SAFETY: Connected database does not match --expect-database.");
    }
    console.log(await importReviewPilot(connection.db, storage, manifestBytes, media, admin!, reviewer));
  } finally {
    await connection.close();
  }
}
