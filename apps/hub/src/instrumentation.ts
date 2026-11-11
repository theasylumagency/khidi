export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NODE_ENV === "production") {
    const { assertProductionConfiguration } = await import("@khidi/shared/production-config");
    assertProductionConfiguration();
    const { webauthnConfig } = await import("@khidi/auth/webauthn-config");
    webauthnConfig();
    const {vapidConfig}=await import("@khidi/notifications/push-config");vapidConfig();
    const [{ mediaSigningSecret }, { createMediaStorage }] = await Promise.all([import("@khidi/media/signing"), import("@khidi/media/storage-config")]);
    mediaSigningSecret(); createMediaStorage();
  }
}
