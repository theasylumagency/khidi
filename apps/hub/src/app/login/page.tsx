import { redirect } from "next/navigation";
import { getCurrentPrincipal, getRegisteredDevicePinContext, isSharedWarehouseBrowser } from "../../lib/session.ts";
import { LoginForms } from "../../components/login-forms.tsx";
import { t } from "@khidi/i18n";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ session?: string }> }) {
  const existingPrincipal = await getCurrentPrincipal();
  if (existingPrincipal) {
    redirect("/");
  }

  const devicePinContext = await getRegisteredDevicePinContext();

  return (
    <div style={{ display: "grid", gap: "1.5rem" }}>
      {(await searchParams).session === "expired" ? <p role="status">{t("session.ended")}</p> : null}
      <LoginForms
        sharedWarehouseDevice={await isSharedWarehouseBrowser()}
        registeredDevice={devicePinContext?.device ?? null}
        pinUsers={devicePinContext?.users ?? []}
      />
    </div>
  );
}
