import { storefrontOpenApi } from "../apps/hub/src/lib/storefront-contracts.ts";
process.stdout.write(JSON.stringify(storefrontOpenApi(),null,2)+"\n");
