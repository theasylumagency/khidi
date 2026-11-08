import { getDb } from "../packages/db/src/index.ts";
import { getMediaStorage } from "../packages/media/src/storage-config.ts";
import { generateDailyReports,previousTbilisiDay } from "../packages/reports/src/daily.ts";
await generateDailyReports(getDb(),getMediaStorage(),process.argv[2]??previousTbilisiDay());
console.log("Khidi daily reports generated.");
process.exit(0);
