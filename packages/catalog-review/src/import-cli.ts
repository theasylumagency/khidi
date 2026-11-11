import { readFile } from "node:fs/promises";
import { connectMigratorDatabase } from "@khidi/db";
import { createMediaStorage } from "@khidi/media/storage-config";
import { assertLocalReviewDatabase, importReviewPilot } from "./import.ts";

const [manifest, media, admin, reviewer] = process.argv.slice(2);
if (!manifest || !media || !admin || process.argv.length > 6) {
  throw new Error("Usage: ops:catalog-review-pilot MANIFEST AUDITED_MEDIA_DIRECTORY ADMIN_EMAIL [REVIEWER_EMAIL]");
}
assertLocalReviewDatabase();
const connection = connectMigratorDatabase();
try {
  console.log(await importReviewPilot(connection.db, createMediaStorage(), await readFile(manifest), media, admin, reviewer));
} finally {
  await connection.close();
}
