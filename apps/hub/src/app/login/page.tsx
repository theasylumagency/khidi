import { redirect } from "next/navigation";
import { getCurrentPrincipal, getRegisteredDevicePinContext } from "../../lib/session.ts";
import { LoginForms } from "../../components/login-forms.tsx";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const existingPrincipal = await getCurrentPrincipal();
  if (existingPrincipal) {
    redirect("/");
  }

  const devicePinContext = await getRegisteredDevicePinContext();

  return (
    <div style={{ display: "grid", gap: "1.5rem" }}>
      <LoginForms
        registeredDevice={devicePinContext?.device ?? null}
        pinUsers={devicePinContext?.users ?? []}
      />
    </div>
  );
}
