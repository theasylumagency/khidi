"use client";
import { useEffect, useState } from "react";
import { t } from "@khidi/i18n";
import { OfficePasswordField } from "./office-password-field.tsx";
import { OfficeLoginForm } from "./office-login-form.tsx";
import { StrongReauthentication } from "./strong-reauthentication.tsx";
import { type TotpEnrollment } from "./totp-enrollment.tsx";
import { platformPasskeyAvailable, runPasskey, securityRequest, SecurityActionError } from "../lib/passkey-client.ts";
import "./office-login-form.css";
import "./account-security.css";

interface Key { id: string; displayName: string; createdAt: string; lastUsedAt: string | null }
interface State { keys: Key[]; sharedDevice: boolean; totpEnabled: boolean; canStartTotp: boolean }
const date = (value: string | null) => value ? new Intl.DateTimeFormat("ka-GE", { timeZone: "Asia/Tbilisi", dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "—";

export function AccountSecurity({ email }: { email: string }) {
  const [state, setState] = useState<State | null>(null), [available, setAvailable] = useState(false), [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(""), [reauth, setReauth] = useState(false), [name, setName] = useState("");
  const [password, setPassword] = useState(""), [newPassword, setNewPassword] = useState(""), [repeat, setRepeat] = useState("");
  const [confirmKey, setConfirmKey] = useState<string | null>(null), [confirmTotp, setConfirmTotp] = useState(false);
  const [enrollment, setEnrollment] = useState<{ email: string; password: string; enrollment: TotpEnrollment } | null>(null);
  async function refresh() {
    const response = await fetch("/api/auth/passkeys", { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) throw new Error();
    setState(await response.json());
  }
  useEffect(() => { void refresh().catch(() => setMessage(t("passkey.operation_failed"))); void platformPasskeyAvailable().then(setAvailable); }, []);
  async function perform(action: () => Promise<unknown>, refreshAfter = true) {
    setBusy(true); setMessage("");
    try { await action(); if (refreshAfter) await refresh(); }
    catch (error) {
      if (error instanceof SecurityActionError && error.code === "RECENT_AUTH_REQUIRED") setReauth(true);
      setMessage(error instanceof SecurityActionError ? error.message : t("passkey.operation_failed"));
    } finally { setBusy(false); }
  }
  if (enrollment) return <OfficeLoginForm initialEnrollment={enrollment} beforeLogin={async () => {}}
    passkeysAllowed={!state?.sharedDevice} onAuthenticated={() => { setEnrollment(null); setMessage(t("auth.enrollment_complete")); void refresh().catch(() => setMessage(t("passkey.operation_failed"))); }} />;
  return <div className="account-security">
    <h1>{t("passkey.security_title")}</h1>
    {message ? <p role="status" className="security-notice">{message}</p> : null}
    {reauth ? <StrongReauthentication sharedDevice={state?.sharedDevice} onSuccess={() => { setReauth(false); setMessage(t("passkey.reauth_done")); }} /> : null}
    {!state ? <p>{t("auth.checking")}</p> : <>
      <section className="office-login">
        <h2>{t("passkey.keys_title")}</h2><p>{t("passkey.sync_help")}</p>
        {state.sharedDevice ? <p>{t("passkey.shared_unavailable")}</p> : <>
          {!state.keys.length ? <p>{t("passkey.no_keys")}</p> : <div className="security-key-list">{state.keys.map((key) => <div className="security-key" key={key.id}>
            <label>{t("passkey.name")}<input aria-label={`${t("passkey.name")} ${key.displayName}`} maxLength={100} defaultValue={key.displayName} onChange={(event) => setState((current) => current ? { ...current, keys: current.keys.map((item) => item.id === key.id ? { ...item, displayName: event.target.value } : item) } : current)} /></label>
            <p>{t("passkey.created")}: {date(key.createdAt)} · {t("passkey.last_used")}: {date(key.lastUsedAt)}</p>
            <div className="security-actions">
              <button type="button" disabled={busy} onClick={() => void perform(() => securityRequest("rename", { id: key.id, displayName: key.displayName }))}>{t("passkey.rename")}</button>
              <button type="button" disabled={busy} onClick={() => setConfirmKey(key.id)}>{t("passkey.revoke")}</button>
            </div>
            {confirmKey === key.id ? <div role="group" aria-label={t("passkey.revoke")}><p>{t("passkey.revoke_warning")}</p>
              <button type="button" disabled={busy} onClick={() => void perform(async () => { const result = await securityRequest("revoke", { id: key.id }); if (result.currentSessionRevoked) window.location.assign("/login"); else await refresh(); setConfirmKey(null); }, false)}>{t("passkey.confirm_revoke")}</button>
              <button type="button" onClick={() => setConfirmKey(null)}>{t("auth.cancel")}</button></div> : null}
          </div>)}</div>}
          {available ? <form onSubmit={(event) => { event.preventDefault(); void perform(async () => { await runPasskey("register", name || t("passkey.default_name")); setName(""); }); }}>
            <label>{t("passkey.name")}<input maxLength={100} value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" /></label>
            <button type="submit" disabled={busy}>{t("passkey.enable")}</button>
          </form> : <p>{t("passkey.platform_unavailable")}</p>}
          {!state.totpEnabled && state.canStartTotp ? <p>{t("passkey.enable_totp_first")}</p> : null}
        </>}
      </section>
      <section className="office-login">
        <h2>{t("passkey.totp_settings")}</h2><p>{t(state.totpEnabled ? "passkey.totp_enabled" : "passkey.enable_totp_first")}</p>
        <form onSubmit={(event) => { event.preventDefault(); if (!state.canStartTotp && !confirmTotp) { setConfirmTotp(true); return; }
          void perform(async () => { const result = await securityRequest(state.canStartTotp ? "totp-start" : "totp-replace", { password }); setEnrollment({ email, password, enrollment: result.enrollment }); setPassword(""); }, false); }}>
          <OfficePasswordField value={password} onChange={setPassword} />
          {confirmTotp ? <p>{t("passkey.totp_replace_warning")}</p> : null}
          <button disabled={busy} type="submit">{t(state.canStartTotp ? "passkey.totp_start" : confirmTotp ? "passkey.totp_replace_confirm" : "passkey.totp_replace")}</button>
        </form>
      </section>
      <section className="office-login"><h2>{t("passkey.password_settings")}</h2>
        <form onSubmit={(event) => { event.preventDefault(); if (newPassword !== repeat) { setMessage(t("passkey.password_mismatch")); return; }
          void perform(async () => { await securityRequest("change-password", { password: newPassword }); setNewPassword(""); setRepeat(""); setMessage(t("passkey.password_changed")); }); }}>
          <label>{t("passkey.new_password")}<input type="password" autoComplete="new-password" required minLength={12} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
          <label>{t("passkey.repeat_password")}<input type="password" autoComplete="new-password" required minLength={12} value={repeat} onChange={(event) => setRepeat(event.target.value)} /></label>
          <button disabled={busy} type="submit">{t("passkey.change_password")}</button>
        </form>
      </section>
    </>}
    <a href="/">{t("auth.continue")}</a>
  </div>;
}
