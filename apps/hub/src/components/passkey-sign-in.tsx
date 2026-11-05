"use client";
import { useState } from "react";
import { t } from "@khidi/i18n";
import { runPasskey } from "../lib/passkey-client.ts";
import { passkeyErrorMessage } from "../lib/passkey-errors.ts";

export function PasskeySignIn({ primary = false }: { primary?: boolean }) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  return <div>
    <button className={primary ? "auth-primary" : "auth-secondary"} type="button" disabled={busy} onClick={async () => {
      setBusy(true); setMessage("");
      try {
        await runPasskey("sign-in");
        navigator.serviceWorker?.controller?.postMessage({ type: "CLEAR_AUTH_CACHES" });
        window.location.assign("/");
      } catch (error) { setMessage(`${passkeyErrorMessage(error)} ${t("passkey.fallback")}`); }
      finally { setBusy(false); }
    }}>{busy ? t("auth.checking") : t("passkey.sign_in")}</button>
    {message ? <p role="alert" className="auth-error">{message}</p> : null}
  </div>;
}
