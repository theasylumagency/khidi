"use client";
import { useEffect,useState } from "react";
import { t } from "@khidi/i18n";
export function NotificationBadge(){
 const [count,setCount]=useState<number|null>(null);
 useEffect(()=>{let active=true;const controller=new AbortController();const refresh=async()=>{try{const response=await fetch("/api/notifications?count=1",{cache:"no-store",signal:controller.signal});if(response.ok){const body=await response.json();if(active)setCount(body.unread);}}catch{/* Keep navigation available during network loss. */}};
  void refresh();const timer=setInterval(()=>void refresh(),60000);window.addEventListener("khidi-notifications-changed",refresh);return()=>{active=false;controller.abort();clearInterval(timer);window.removeEventListener("khidi-notifications-changed",refresh);};},[]);
 return count ? <span aria-label={t("notification.unread_count").replace("{count}",String(count))}> ({count})</span> : null;
}
