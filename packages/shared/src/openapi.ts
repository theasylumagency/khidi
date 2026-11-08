import { z } from "zod";
/** JSON Schema generated from the pinned Zod 3 contract, including strict object keys. */
export function zodJsonSchema(schema:z.ZodTypeAny):Record<string,unknown> {
  if(schema instanceof z.ZodEffects)return zodJsonSchema(schema.innerType());
  if(schema instanceof z.ZodOptional)return zodJsonSchema(schema.unwrap());
  if(schema instanceof z.ZodDefault)return {...zodJsonSchema(schema.removeDefault()),default:schema._def.defaultValue()};
  if(schema instanceof z.ZodNullable)return {anyOf:[zodJsonSchema(schema.unwrap()),{type:"null"}]};
  if(schema instanceof z.ZodObject) {
    const properties=Object.fromEntries(Object.entries(schema.shape).map(([k,v])=>[k,zodJsonSchema(v as z.ZodTypeAny)]));
    return {type:"object",properties,required:Object.entries(schema.shape).filter(([,s])=>!(s as z.ZodTypeAny).isOptional()).map(([k])=>k),additionalProperties:schema._def.unknownKeys!=="strict"};
  }
  if(schema instanceof z.ZodArray)return {type:"array",items:zodJsonSchema(schema.element),...(schema._def.minLength ? {minItems:schema._def.minLength.value} : {}),...(schema._def.maxLength ? {maxItems:schema._def.maxLength.value} : {})};
  if(schema instanceof z.ZodEnum)return {type:"string",enum:schema.options};
  if(schema instanceof z.ZodLiteral)return {const:schema.value,type:typeof schema.value};
  if(schema instanceof z.ZodBoolean)return {type:"boolean"};
  if(schema instanceof z.ZodString) {
    const result:Record<string,unknown>={type:"string"};
    for(const c of schema._def.checks) {
      if(c.kind==="uuid")result.format="uuid";if(c.kind==="datetime")result.format="date-time";
      if(c.kind==="regex")result.pattern=c.regex.source;if(c.kind==="min")result.minLength=c.value;if(c.kind==="max")result.maxLength=c.value;
    }return result;
  }
  if(schema instanceof z.ZodNumber) {
    const result:Record<string,unknown>={type:schema.isInt ? "integer" : "number"};
    for(const c of schema._def.checks) {if(c.kind==="min")result[c.inclusive ? "minimum" : "exclusiveMinimum"]=c.value;if(c.kind==="max")result[c.inclusive ? "maximum" : "exclusiveMaximum"]=c.value;}return result;
  }
  if(schema instanceof z.ZodUnion)return {oneOf:schema.options.map(zodJsonSchema)};
  if(schema instanceof z.ZodRecord)return {type:"object",additionalProperties:zodJsonSchema(schema.valueSchema)};
  if(schema instanceof z.ZodUnknown)return {};
  throw new Error("Unsupported OpenAPI schema: "+schema._def.typeName);
}
