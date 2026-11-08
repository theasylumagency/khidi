import { and,eq,inArray,or,sql,type SQL } from "drizzle-orm";
import { notifications,notificationReceipts,userEntityMemberships,userPermissions,users,type DbExecutor } from "@khidi/db";
import { AppError } from "@khidi/shared";
export async function notificationUser(db:DbExecutor,userId:string) {
 const [user]=await db.select({id:users.id,role:users.role}).from(users).where(and(eq(users.id,userId),eq(users.active,true)));
 if(!user)throw new AppError("UNAUTHORIZED","Active user required.");return user;
}
export async function notificationVisibility(db:DbExecutor,user:{id:string;role:string}):Promise<SQL> {
 const installment=sql`(${notifications.type}<>'RESERVATION_EXPIRING' OR (
  EXISTS(SELECT 1 FROM user_entity_memberships m WHERE m.user_id=${user.id} AND m.legal_entity_id=${notifications.legalEntityId})
  AND EXISTS(SELECT 1 FROM reservations r WHERE r.id=${notifications.entityId} AND r.payment_method='BANK_INSTALLMENT' AND r.status='RESERVED'
    AND r.expires_at=(${notifications.parametersJson}->>'expiresAt')::timestamptz)))`;
 if(user.role==="ADMIN")return installment;
 const [memberships,permissions]=await Promise.all([db.select().from(userEntityMemberships).where(eq(userEntityMemberships.userId,user.id)),db.select().from(userPermissions).where(eq(userPermissions.userId,user.id))]);
 const conditions:SQL[]=[];
 if(user.role==="OPERATOR")conditions.push(and(eq(notifications.audience,"PRODUCT"))!);
 if(user.role==="ORDER_MANAGER")conditions.push(eq(notifications.audience,"FULFILLMENT"));
 if(user.role==="STOCK_MANAGER"&&memberships.length)conditions.push(and(eq(notifications.audience,"STOCK_OWNER"),inArray(notifications.legalEntityId,memberships.map(m=>m.legalEntityId)))!);
 if(user.role!=="WAREHOUSE"&&memberships.length&&permissions.some(p=>p.permissionKey==="reports.view"))conditions.push(and(eq(notifications.audience,"REPORT"),inArray(notifications.legalEntityId,memberships.map(m=>m.legalEntityId)))!);
 conditions.push(sql`${notifications.audience}='TASK' AND EXISTS(SELECT 1 FROM scan_tasks t WHERE t.id=${notifications.taskId}
   AND (t.assignee_user_id=${user.id} OR t.assignee_role=${user.role}) AND t.task_type IN ${user.role==="WAREHOUSE" ? ["INTAKE_UNIQUE","PHOTO_REQUEST","EVIDENCE_REQUEST"] : ["INTAKE_UNIQUE"]})`);
 return and(or(...conditions)??sql`false`,installment)!;
}
export async function receiptAccess(db:DbExecutor,userId:string) {
 const user=await notificationUser(db,userId);return and(eq(notificationReceipts.userId,userId),await notificationVisibility(db,user));
}
