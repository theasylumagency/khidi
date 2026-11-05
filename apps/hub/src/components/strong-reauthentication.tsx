"use client";
import { useState, type FormEvent } from "react";
import { t } from "@khidi/i18n";
import { OfficePasswordField } from "./office-password-field.tsx";
import { runPasskey, securityRequest } from "../lib/passkey-client.ts";
import { passkeyErrorMessage } from "../lib/passkey-errors.ts";
import "./office-login-form.css";

export function StrongReauthentication({ sharedDevice = false, onSuccess }: { sharedDevice?: boolean; onSuccess(): void }) {
  const [password, setPassword] = useState(""), [code, setCode] = useState(""), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  async function confirm(passkey: boolean) {
    setBusy(true); setMessage("");
    try {
      if (passkey) await runPasskey("reauth");
      else await securityRequest("password-reauth", { password, totpCode: code });
      setPassword(""); setCode(""); onSuccess();
    } catch (error) { setMessage(passkey ? passkeyErrorMessage(error) : t("passkey.reauth_failed")); }
    finally { setBusy(false); }
  }
  return <form className="office-login security-reauth" onSubmit={(event: FormEvent) => { event.preventDefault(); void confirm(false); }}>
    <h3>{t("passkey.reauth_title")}</h3><p>{t("passkey.reauth_help")}</p>
    <fieldset disabled={busy}>
      <OfficePasswordField value={password} onChange={setPassword} />
      <label>{t("auth.totp_code")}<input name="totpCode" type="text" inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{6}" minLength={6} maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} /></label>
      <button className="auth-primary" type="submit">{t("passkey.reauth_confirm")}</button>
      {!sharedDevice ? <button className="auth-secondary" type="button" onClick={() => void confirm(true)}>{t("passkey.reauth_with_passkey")}</button> : null}
    </fieldset>
    {message ? <p className="auth-error" role="alert">{message}</p> : null}
  </form>;
}
