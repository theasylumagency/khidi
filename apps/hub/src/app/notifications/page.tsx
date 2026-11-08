import { getDb } from "@khidi/db";
import { listNotifications,notificationSettings,installmentReminderLeadHours } from "@khidi/notifications";
import { requirePageAuth } from "../../lib/session.ts";
import { NotificationCenter } from "../../components/notification-center.tsx";
import "../../components/inventory.css";
export const dynamic="force-dynamic";
export default async function NotificationsPage({searchParams}:{searchParams:Promise<{cursor?:string}>}){
 const p=await requirePageAuth(),query=await searchParams,db=getDb();
 const [view,preferences,leadHours]=await Promise.all([listNotifications(db,p.userId,query.cursor?{cursor:query.cursor}:{}),notificationSettings(db,p.userId),p.role==="ADMIN"?installmentReminderLeadHours(db):undefined]);
 return <NotificationCenter rows={view.rows.map(({notification:n,readAt,muted})=>({id:n.id,type:n.type,titleKey:n.titleKey,level:n.level,deepLink:n.deepLink,createdAt:n.createdAt.toISOString(),read:!!readAt,muted}))} nextCursor={view.nextCursor} preferences={preferences} leadHours={leadHours}/>;
}
