import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { users, type DbExecutor } from "@khidi/db";
import { withDomainTransaction } from "@khidi/domain";
import { AppError, createUuidV7 } from "@khidi/shared";
import { officePassword } from "./password-policy.ts";

const bootstrapInput = z.object({ email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  fullName: z.string().trim().min(1).max(200), password: officePassword }).strict();

/** Operator-only entry point; no API route. Never changes an existing account. */
export async function bootstrapFirstAdmin(db: DbExecutor, input: { email: string; fullName: string; password: string }) {
  const parsed = bootstrapInput.safeParse(input);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "A valid email/name and a password of at least 12 characters and at most 72 UTF-8 bytes are required.");
  const id = createUuidV7(), passwordHash = await bcrypt.hash(parsed.data.password, 10);
  return withDomainTransaction(db, { userId: id }, async (ctx) => {
    // Serializes simultaneous bootstrap attempts and ordinary user creation.
    await ctx.tx.execute(sql`LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE`);
    if ((await ctx.tx.select({ id: users.id }).from(users).limit(1)).length) throw new AppError("PRECONDITION_FAILED", "SAFETY: Admin bootstrap requires a database with no users. Existing accounts were not changed.");
    await ctx.tx.insert(users).values({ id, email: parsed.data.email, fullName: parsed.data.fullName, passwordHash,
      role: "ADMIN", locale: "ka", active: true, totpEnrollmentRequired: true, totpEnabled: false });
    const after = { role: "ADMIN", totpEnrollmentRequired: true };
    await ctx.recordAudit({ action: "FIRST_ADMIN_BOOTSTRAPPED", entityType: "user", entityId: id, after });
    await ctx.emitOutboxEvent({ eventType: "FIRST_ADMIN_BOOTSTRAPPED", aggregateType: "user", aggregateId: id, payload: after, consumers: [] });
    return { id };
  });
}
