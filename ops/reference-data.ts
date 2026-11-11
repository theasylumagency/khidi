import { getDb,closeAppPool } from "../packages/db/src/client.ts";
import { applyReferenceCatalog } from "../packages/products/src/reference-data.ts";
import { referenceCommand } from "../packages/products/src/reference-command.ts";
try {
 const command=referenceCommand(process.argv.slice(2),process.env);
 console.log(JSON.stringify({database:command.database,...await applyReferenceCatalog(getDb(),command.apply)},null,2));
}catch{console.error("SAFETY: Khidi reference-data operation failed; verify the explicit target and review the catalog package. No development seed is used.");process.exitCode=1;}
finally{await closeAppPool();}
