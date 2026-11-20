import { reviewImageModels } from "@khidi/db";
import { providerConfigured } from "@khidi/media";

/** AI image methods whose server-side key is configured. Read per request; keys never reach the browser. */
export const readyImageModels = () => reviewImageModels.filter(model => model !== "local" && providerConfigured(model));
