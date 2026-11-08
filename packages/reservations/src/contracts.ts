import { z } from "zod";
import { AppError } from "@khidi/shared";

export const fulfillmentModes=["SIMPLIFIED_FULFILLMENT","CONTROLLED_FULFILLMENT"] as const;
export type FulfillmentMode=typeof fulfillmentModes[number];
export const orderReferenceSchema=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/).refine((s)=>!/^\d{9,}$/.test(s));
const money=z.number().int().min(0).max(2_147_483_647);
export const confirmationSchema=z.object({
  deliveryMethod:z.enum(["PICKUP","COURIER","OTHER"]),
  shipBy:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s)=>!Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0,10)===s),
  prices:z.array(z.object({skuId:z.string().uuid(),finalUnitPriceMinor:money,currency:z.literal("GEL")}).strict()).min(1).max(100)
}).strict();
export const reserveSchema=z.object({storefrontOrderRef:orderReferenceSchema,paymentMethod:z.enum(["CARD","BANK_INSTALLMENT","CASH_ON_DELIVERY","PAY_ON_PICKUP"]),
  locale:z.enum(["ka","en"]).default("ka"),items:z.array(z.object({skuId:z.string().uuid(),quantity:z.number().int().positive().max(1_000_000)}).strict()).min(1).max(100),
  confirmation:confirmationSchema.optional()
}).strict().superRefine((s,ctx)=>{
  if (new Set(s.items.map((i)=>i.skuId)).size!==s.items.length) ctx.addIssue({code:"custom",message:"Duplicate cart item."});
  if (isCod(s.paymentMethod)!==!!s.confirmation) ctx.addIssue({code:"custom",message:"COD/pickup confirms at reserve; card/installment confirms at commit."});
});
export const commitSchema=z.object({reservationId:z.string().uuid(),confirmation:confirmationSchema}).strict();
export const releaseSchema=z.object({reservationId:z.string().uuid(),reason:z.string().trim().min(1).max(1000)}).strict();
export const extendSchema=z.object({reservationId:z.string().uuid(),expiresAt:z.string().datetime({offset:true})}).strict();
export type ReserveInput=z.input<typeof reserveSchema>;
export type Confirmation=z.infer<typeof confirmationSchema>;
export type CommitInput=z.infer<typeof commitSchema>;
export interface OrderResponse extends Record<string,unknown> {
  reservationId?:string; fulfillmentRequestId?:string; status?:string; expiresAt?:string; code?:string;
  confirmation?:"SCAN"|"MANUAL"|"AUTO_ASSUMED"; requiresReturnToShelf?:boolean;
}
export function isCod(payment:string) {return payment==="CASH_ON_DELIVERY" || payment==="PAY_ON_PICKUP";}
export function parseInput<T>(schema:z.ZodType<T>,input:unknown):T {
  const parsed=schema.safeParse(input);
  if(!parsed.success) throw new AppError("VALIDATION_ERROR","Invalid order workflow payload.");
  return parsed.data;
}
