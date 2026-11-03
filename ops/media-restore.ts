import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { captureRestoreSnapshot } from "../packages/db/src/restore-verification.ts";
import { createMediaStorage } from "../packages/media/src/storage-config.ts";
import { mediaLocation, rawManifestSchema, restoredMediaEnvironment, verifyRawSamples } from "../packages/media/src/restore.ts";
import { required } from "./common.ts";
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifestPath = required("MEDIA_RAW_MANIFEST");
  if (process.argv.includes("--capture")) {
    if (process.env.SOURCE_WRITERS_STOPPED !== "yes") throw new Error("Stop source writers before capturing the recovery manifest.");
    const snapshot = await captureRestoreSnapshot(required("SOURCE_MIGRATOR_URL"));
    await verifyRawSamples(snapshot.mediaSamples, createMediaStorage(), { sourceVersions: true });
    await writeFile(manifestPath, JSON.stringify({ version: 1, capturedAt: snapshot.capturedAt, sourceLocation: mediaLocation(process.env), samples: snapshot.mediaSamples }, null, 2), { flag: "wx", mode: 0o600 });
    console.log(`Khidi raw manifest saved: ${snapshot.mediaSamples.length} verified files.`);
  } else {
    const manifest = rawManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8"))), target = restoredMediaEnvironment(process.env);
    if (manifest.sourceLocation === mediaLocation(target)) throw new Error("Restore verification must use separate media storage.");
    const snapshot = await captureRestoreSnapshot(required("RESTORE_MIGRATOR_URL"));
    console.log(JSON.stringify(await verifyRawSamples(manifest.samples, createMediaStorage(target), { databaseSamples: snapshot.mediaSamples })));
  }
}
