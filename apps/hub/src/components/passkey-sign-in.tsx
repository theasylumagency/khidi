"use client";
import { useEffect, useState } from "react";
import { t } from "@khidi/i18n";
import { runPasskey } from "../lib/passkey-client.ts";

export function PasskeySignIn() {
  const [available, setAvailable] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  useEffect(() => { setAvailable(typeof PublicKeyCredential !== "undefined"); }, []);
  if (!available) return null;
  return <div>
    <button className="auth-secondary" type="button" disabled={busy} onClick={async () => {
      setBusy(true); setMessage("");
      try {
        await runPasskey("sign-in");
        navigator.serviceWorker?.controller?.postMessage({ type: "CLEAR_AUTH_CACHES" });
        window.location.assign("/");
      } catch { setMessage(t("passkey.sign_in_failed")); }
      finally { setBusy(false); }
    }}>{busy ? t("auth.checking") : t("passkey.sign_in")}</button>
    {message ? <p role="alert" className="auth-error">{message}</p> : null}
  </div>;
}
