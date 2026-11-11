import { closeAppPool } from "../packages/db/src/client.ts";
import { createMediaStorage } from "../packages/media/src/storage-config.ts";
import { runM11Scenarios } from "./m11-e2e-scenarios.ts";
try {console.log(JSON.stringify(await runM11Scenarios(createMediaStorage())));}
finally{await closeAppPool();}
