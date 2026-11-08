import { cookies, headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { storefrontApiHost } from "@khidi/shared/hosts";
import { getDb } from "@khidi/db";
import {
  verifySessionToken,
  listPinEnabledUsersForRegisteredDevice,
  isWarehouseBrowser,
  type AuthenticatedPrincipal
} from "@khidi/auth";
import { AppError, type UserRole } from "@khidi/shared";

export const KHIDI_SESSION_COOKIE = "khidi_session";
export const KHIDI_DEVICE_COOKIE = "khidi_device_token";

export async function isSharedWarehouseBrowser(): Promise<boolean> {
  const cookieStore = await cookies();
  return isWarehouseBrowser(getDb(), cookieStore.get(KHIDI_DEVICE_COOKIE)?.value);
}

export async function getCurrentPrincipal(options?: { throwOnUnavailable: boolean }): Promise<AuthenticatedPrincipal | null> {
  if((await headers()).get("host")?.toLowerCase()===storefrontApiHost()) notFound();
  const cookieStore = await cookies();
  const rawToken = cookieStore.get(KHIDI_SESSION_COOKIE)?.value;
  if (!rawToken) {
    return null;
  }

  try {
    const db = getDb();
    return await verifySessionToken(db, rawToken);
  } catch (error) {
    if (options?.throwOnUnavailable && !(error instanceof AppError)) throw error;
    return null;
  }
}

export async function requirePageAuth(options?: {
  allowedRoles?: UserRole[];
}): Promise<AuthenticatedPrincipal> {
  const principal = await getCurrentPrincipal();
  if (!principal) {
    redirect("/login");
  }

  if (options?.allowedRoles && !options.allowedRoles.includes(principal.role)) {
    redirect("/?forbidden=1");
  }

  return principal;
}

export async function getRegisteredDevicePinContext() {
  const cookieStore = await cookies();
  const rawDeviceToken = cookieStore.get(KHIDI_DEVICE_COOKIE)?.value;
  if (!rawDeviceToken) {
    return null;
  }

  try {
    const db = getDb();
    return await listPinEnabledUsersForRegisteredDevice(db, rawDeviceToken);
  } catch {
    return null;
  }
}
