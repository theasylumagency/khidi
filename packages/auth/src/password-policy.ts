import { z } from "zod";

// Match the existing bootstrap password policy, including bcrypt's byte limit.
export const officePassword = z.string().max(72).min(12)
  .refine((value) => Buffer.byteLength(value, "utf8") <= 72);
