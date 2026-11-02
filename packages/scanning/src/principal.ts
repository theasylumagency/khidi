import { eq } from "drizzle-orm";
import type { AuthenticatedPrincipal } from "@khidi/auth";
import { type DbExecutor, users } from "@khidi/db";
import { AppError } from "@khidi/shared";

export async function assertScanningPrincipal(db: DbExecutor, principal: AuthenticatedPrincipal, adminOnly = false) {
  const [user] = await db.select().from(users).where(eq(users.id, principal.userId)).limit(1);
  if (!user?.active || user.role !== principal.role) throw new AppError("UNAUTHORIZED", "Session principal is no longer active.");
  if (adminOnly && user.role !== "ADMIN") throw new AppError("FORBIDDEN", "Only an administrator may manage scanning.");
}
