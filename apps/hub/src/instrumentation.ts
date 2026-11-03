export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NODE_ENV === "production") {
    const [{ mediaSigningSecret }, { createMediaStorage }] = await Promise.all([import("@khidi/media/signing"), import("@khidi/media/storage-config")]);
    mediaSigningSecret(); createMediaStorage();
  }
}
