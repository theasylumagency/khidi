import { assertProductionConfiguration } from "../packages/shared/src/production-config.ts";
assertProductionConfiguration(process.env,process.argv.includes("--runtime")?"runtime":"deployment");
console.log("Khidi production configuration verified. Live backup/storage checks remain required; no credentials were printed.");
