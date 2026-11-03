import type { AuthenticatedPrincipal } from "@khidi/auth";
import { type DbExecutor, users } from "@khidi/db";
import { eq } from "drizzle-orm";
import { AppError } from "@khidi/shared";
export async function assertMediaPrincipal(db: DbExecutor, principal: AuthenticatedPrincipal, adminOnly = false) {
  const [user] = await db.select({ active: users.active, role: users.role }).from(users).where(eq(users.id, principal.userId)).limit(1);
  if (!user?.active || user.role !== principal.role) throw new AppError("UNAUTHORIZED", "Inactive media principal.");
  if (adminOnly && principal.role !== "ADMIN") throw new AppError("FORBIDDEN", "Administrator required.");
}
