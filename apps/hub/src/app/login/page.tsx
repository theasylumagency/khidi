import { redirect } from "next/navigation";
import { getCurrentPrincipal, getRegisteredDevicePinContext, isSharedWarehouseBrowser } from "../../lib/session.ts";
import { LoginForms } from "../../components/login-forms.tsx";
import { t } from "@khidi/i18n";
import { cookies } from "next/headers";
import { getDb } from "@khidi/db";
import { getQuickSignInAccount } from "@khidi/auth";
import { QUICK_SIGN_IN_COOKIE, readQuickSignInPreference } from "../../lib/quick-sign-in-cookie.ts";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ session?: string }> }) {
  const existingPrincipal = await getCurrentPrincipal();
  if (existingPrincipal) {
    redirect("/");
  }

  const [devicePinContext, sharedWarehouseDevice, cookieStore, query] = await Promise.all([
    getRegisteredDevicePinContext(), isSharedWarehouseBrowser(), cookies(), searchParams
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
