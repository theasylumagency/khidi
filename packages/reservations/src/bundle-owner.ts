import { AppError } from "@khidi/shared";
/** The allocation plan must stay inside the storefront's single-owner pool. */
export function assertBundleSingleOwner(composed:boolean, components:readonly {ownerMapping:{legalEntityId:string}|null}[]) {
 if(composed && (components.length===0 || components.some(c=>!c.ownerMapping) ||
   new Set(components.map(c=>c.ownerMapping!.legalEntityId)).size!==1))
   throw new AppError("PRECONDITION_FAILED","Bundle components must have one stock owner.");
}
