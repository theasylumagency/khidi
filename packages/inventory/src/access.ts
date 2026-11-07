import { and, eq } from "drizzle-orm";
import { users, userEntityMemberships, type DbExecutor } from "@khidi/db";
import type { DomainActor } from "@khidi/domain";
import { AppError } from "@khidi/shared";

export async function inventoryAccess(db: DbExecutor, actor: DomainActor, ownerEntityId?: string, adminOnly=false) {
  const [user]=actor.userId ? await db.select().from(users).where(and(eq(users.id,actor.userId),eq(users.active,true))) : [];
  if(!user || !["ADMIN","STOCK_MANAGER"].includes(user.role) || adminOnly && user.role!=="ADMIN") throw new AppError("FORBIDDEN","Inventory access denied.");
  const memberships=await db.select().from(userEntityMemberships).where(eq(userEntityMemberships.userId,user.id));
  const ownerIds=memberships.map((m)=>m.legalEntityId);
  if(user.role!=="ADMIN" && ownerEntityId && !ownerIds.includes(ownerEntityId)) throw new AppError("FORBIDDEN","Pool belongs to another entity.");
  return {user,ownerIds};
}
export const storefrontInventoryKey=(id:string)=>"inventory:storefront:"+id;
export { relationshipInventoryKey } from "@khidi/domain/locking";
