import { getDb } from "@khidi/db";
import { listProductTypes,EDITABLE_SUBTYPE_FIELDS } from "@khidi/products";
import { requirePageAuth,isSharedWarehouseBrowser } from "../../../lib/session.ts";
import { SubtypeCreateForm } from "../../../components/subtype-create-form.tsx";
export const dynamic="force-dynamic";
export default async function ProductConfigurationPage() {
 await requirePageAuth({ allowedRoles: ["ADMIN"] });
 const [types,sharedDevice]=await Promise.all([listProductTypes(getDb()),isSharedWarehouseBrowser()]);
 return <SubtypeCreateForm sharedDevice={sharedDevice} types={types.filter(type=>type.key in EDITABLE_SUBTYPE_FIELDS).map(type=>{
  const field=type.attributeSchemaJson.find(f=>f.key===EDITABLE_SUBTYPE_FIELDS[type.key as keyof typeof EDITABLE_SUBTYPE_FIELDS]);
  return {key:type.key,name:type.nameKa,values:(field?.enumValues??[]).map(key=>({key,...(field?.enumValueMetadata?.[key]??{labelKa:key,labelEn:key,requiredSpecFields:[]})}))};
 })}/>;
}
