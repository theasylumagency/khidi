export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NODE_ENV === "production") {
    const { webauthnConfig } = await import("@khidi/auth/webauthn-config");
    webauthnConfig();
    const [{ mediaSigningSecret }, { createMediaStorage }] = await Promise.all([import("@khidi/media/signing"), import("@khidi/media/storage-config")]);
    mediaSigningSecret(); createMediaStorage();
  }
}
