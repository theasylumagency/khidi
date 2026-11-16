import { redirect } from "next/navigation";
import { getCurrentPrincipal, getRegisteredDevicePinContext, isSharedWarehouseBrowser } from "../../lib/session.ts";
import { LoginForms } from "../../components/login-forms.tsx";
import { t } from "@khidi/i18n";
import { cookies } from "next/headers";
import { getDb } from "@khidi/db";
import { getQuickSignInAccount } from "@khidi/auth";
import { QUICK_SIGN_IN_COOKIE, readQuickSignInPreference } from "../../lib/quick-sign-in-cookie.ts";
import { UserSetup } from "../../components/user-setup.tsx";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ session?: string;setup?:string }> }) {
  const query=await searchParams;
  const existingPrincipal = await getCurrentPrincipal({ allowCatalogReviewer: true });
  if(query.setup==="1")return <UserSetup sessionId={existingPrincipal?.sessionId} registeredDevice={Boolean(await getRegisteredDevicePinContext())}/>;
  if (existingPrincipal) {
    redirect(existingPrincipal.role === "CATALOG_REVIEWER" ? "/review" : "/");
  }

  const [devicePinContext, sharedWarehouseDevice, cookieStore] = await Promise.all([
    getRegisteredDevicePinContext(), isSharedWarehouseBrowser(), cookies()
  ]);
  const preference = sharedWarehouseDevice ? null : readQuickSignInPreference(cookieStore.get(QUICK_SIGN_IN_COOKIE)?.value);
  const quickAccount = preference && preference.mode !== "deferred" ? await getQuickSignInAccount(getDb(), preference.id) : null;

  return (
    <div style={{ display: "grid", gap: "1.5rem" }}>
      {query.session === "expired" ? <p role="status">{t("session.ended")}</p> : null}
      <LoginForms
        sharedWarehouseDevice={sharedWarehouseDevice}
        quickSignInPreferred={Boolean(quickAccount)}
        firstName={preference?.mode === "named" ? quickAccount?.fullName.trim().split(/\s+/)[0] : undefined}
        registeredDevice={devicePinContext?.device ?? null}
        pinUsers={devicePinContext?.users ?? []}
      />
    </div>
  );
}
