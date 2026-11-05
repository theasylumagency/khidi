"use client";
import { useEffect, useState } from "react";
import { t, type TranslationKey } from "@khidi/i18n";
import { OfficePasswordField } from "./office-password-field.tsx";
import { OfficeLoginForm } from "./office-login-form.tsx";
import { StrongReauthentication } from "./strong-reauthentication.tsx";
import { type TotpEnrollment } from "./totp-enrollment.tsx";
import { securityRequest } from "../lib/passkey-client.ts";
import { SecurityActionError } from "../lib/passkey-errors.ts";
import { leaveSession, SESSION_ENROLLMENT_EVENT } from "../lib/session-client.ts";
import { PasskeyRegistration } from "./passkey-registration.tsx";
import "./office-login-form.css";
import "./account-security.css";

interface Key { id: string; displayName: string; registrationPlatform: string | null; createdAt: string; lastUsedAt: string | null }
interface State { keys: Key[]; sharedDevice: boolean; totpEnabled: boolean; canStartTotp: boolean }
type KeyAction = { id: string; action: "rename"; displayName: string } | { id: string; action: "revoke" };
const platformLabels: Partial<Record<string, TranslationKey>> = {
  IPHONE: "passkey.platform.iphone", IPAD: "passkey.platform.ipad", ANDROID: "passkey.platform.android",
  WINDOWS: "passkey.platform.windows", MAC: "passkey.platform.mac", CHROMEOS: "passkey.platform.chromeos",
  LINUX: "passkey.platform.linux", OTHER: "passkey.platform.other"
};
const dateFormatter = new Intl.DateTimeFormat(["ka-GE", "en-GB"], {
  timeZone: "Asia/Tbilisi", dateStyle: "short", timeStyle: "short", hourCycle: "h23"
});
const date = (value: string | null) => value ? dateFormatter.format(new Date(value)) : "—";

export function AccountSecurity({ email, sessionId, offer }: { email: string; sessionId: string; offer: boolean }) {
  const [state, setState] = useState<State | null>(null), [busy, setBusy] = useState<string | null>(null), [registering, setRegistering] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [notice, setNotice] = useState<{ place: string; message: string; reauth?: boolean } | null>(null);
  const [password, setPassword] = useState(""), [newPassword, setNewPassword] = useState(""), [repeat, setRepeat] = useState("");
  const [keyAction, setKeyAction] = useState<KeyAction | null>(null), [confirmTotp, setConfirmTotp] = useState(false);
  const [enrollment, setEnrollment] = useState<{ email: string; password: string; enrollment: TotpEnrollment } | null>(null);
  async function refresh() {
    const response = await fetch("/api/auth/passkeys", { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) throw new Error();
    setState(await response.json());
    setLoadError(false);
  }
  useEffect(() => { void refresh().catch(() => setLoadError(true)); }, []);
  async function perform(place: string, action: () => Promise<void>) {
    setBusy(place); setNotice(null);
    try { await action(); }
    catch (error) {
      setNotice({ place, message: error instanceof SecurityActionError ? error.message : t("passkey.operation_failed"),
        reauth: error instanceof SecurityActionError && error.code === "RECENT_AUTH_REQUIRED" });
    } finally { setBusy(null); }
  }
  function feedback(place: string) {
    return <><p className="security-action-status" role="status">{busy === place ? t("auth.checking") : notice?.place === place ? notice.message : ""}</p>
      {notice?.place === place && notice.reauth ? <StrongReauthentication sharedDevice={state?.sharedDevice} onSuccess={() => setNotice({ place, message: t("passkey.reauth_done") })} /> : null}</>;
  }
  const disabled = !!busy || registering;
  if (enrollment) return <OfficeLoginForm initialEnrollment={enrollment} beforeLogin={async () => {}}
    passkeysAllowed={!state?.sharedDevice} onAuthenticated={() => window.location.replace("/account/security")} />;
  if (offer && !state && !loadError) return <div className="auth-entry"><p role="status">{t("auth.checking")}</p></div>;
  if (offer && state && !state.sharedDevice && state.totpEnabled && state.keys.length === 0) {
    return <div className="auth-entry"><PasskeyRegistration offered needsTotp={false} locked={false}
      onBusyChange={setRegistering} onRegistered={() => window.location.replace("/")} /></div>;
  }
  return <div className="account-security">
    <h1>{t("passkey.security_title")}</h1>
    {loadError ? <p role="status" className="security-notice">{t("passkey.operation_failed")}</p> : null}
    {!state ? (loadError ? null : <p>{t("auth.checking")}</p>) : <>
      {!state.sharedDevice ? <PasskeyRegistration needsTotp={state.canStartTotp} locked={!!busy}
        onBusyChange={setRegistering} onRegistered={() => void refresh().catch(() => setLoadError(true))} /> : null}
      <section className="office-login">
        <h2>{t("passkey.keys_title")}</h2><p>{t("passkey.sync_help")}</p>
        {state.sharedDevice ? <p>{t("passkey.shared_unavailable")}</p> : <>
          {!state.keys.length ? <p>{t("passkey.no_keys")}</p> : <div className="security-key-list">{state.keys.map((key) => {
            const active = keyAction?.id === key.id ? keyAction : null;
            const platform = t(platformLabels[key.registrationPlatform ?? ""] ?? "passkey.platform.unknown");
            return <div className="security-key" key={key.id}>
              <h3>{key.displayName}</h3>
              <p>{t("passkey.registration_platform")} · {platform}</p>
              <p>{t("passkey.created")}: {date(key.createdAt)} · {t("passkey.last_used")}: {date(key.lastUsedAt)}</p>
              {!active ? <div className="security-actions">
                <button className="auth-secondary" type="button" disabled={disabled} onClick={() => {
                  setNotice(null); setKeyAction({ id: key.id, action: "rename", displayName: key.displayName });
                }}>{t("passkey.rename")}</button>
                <button className="auth-secondary" type="button" disabled={disabled} onClick={() => {
                  setNotice(null); setKeyAction({ id: key.id, action: "revoke" });
                }}>{t("passkey.revoke")}</button>
              </div> : null}
              {active?.action === "rename" ? <form onSubmit={(event) => {
                event.preventDefault();
                const displayName = active.displayName.trim();
                if (disabled || !displayName) return;
                void perform(key.id, async () => {
                  await securityRequest("rename", { id: key.id, displayName });
                  await refresh(); setKeyAction(null); setNotice({ place: key.id, message: t("passkey.renamed") });
                });
              }}>
                <label>{t("passkey.name")}<input required maxLength={100} autoComplete="off" autoFocus value={active.displayName} disabled={disabled}
                  onChange={(event) => setKeyAction({ ...active, displayName: event.target.value })} /></label>
                <div className="security-actions">
                  <button className="auth-primary" type="submit" disabled={disabled || !active.displayName.trim()}>{t("passkey.save_name")}</button>
                  <button className="auth-secondary" type="button" disabled={disabled} onClick={() => { setKeyAction(null); setNotice(null); }}>{t("auth.cancel")}</button>
                </div>
              </form> : null}
              {active?.action === "revoke" ? <div role="group" aria-label={t("passkey.revoke")}><p>{t("passkey.revoke_warning")}</p>
                <div className="security-actions">
                  <button className="auth-primary" type="button" disabled={disabled} onClick={() => void perform(key.id, async () => {
                    const result = await securityRequest("revoke", { id: key.id });
                    if (result.currentSessionRevoked) { await leaveSession(sessionId, false); return; }
                    await refresh(); setKeyAction(null); setNotice({ place: "keys", message: t("passkey.revoked") });
                  })}>{t("passkey.confirm_revoke")}</button>
                  <button className="auth-secondary" type="button" disabled={disabled} onClick={() => { setKeyAction(null); setNotice(null); }}>{t("passkey.keep")}</button>
                </div>
              </div> : null}
              {feedback(key.id)}
            </div>;
          })}</div>}
          {feedback("keys")}
        </>}
      </section>
      <section className="office-login" id="totp-settings">
        <h2>{t("passkey.totp_settings")}</h2><p>{t(state.totpEnabled ? "passkey.totp_enabled" : "passkey.enable_totp_first")}</p>
        <form onSubmit={(event) => { event.preventDefault(); if (!state.canStartTotp && !confirmTotp) { setConfirmTotp(true); return; }
          void perform("totp", async () => {
            const result = await securityRequest(state.canStartTotp ? "totp-start" : "totp-replace", { password });
            window.dispatchEvent(new Event(SESSION_ENROLLMENT_EVENT));
            setEnrollment({ email, password, enrollment: result.enrollment }); setPassword("");
          }); }}>
          <OfficePasswordField value={password} onChange={setPassword} />
          {confirmTotp ? <p>{t("passkey.totp_replace_warning")}</p> : null}
          <button disabled={disabled} type="submit">{t(state.canStartTotp ? "passkey.totp_start" : confirmTotp ? "passkey.totp_replace_confirm" : "passkey.totp_replace")}</button>
        </form>
        {feedback("totp")}
      </section>
      <section className="office-login"><h2>{t("passkey.password_settings")}</h2>
        <form onSubmit={(event) => { event.preventDefault(); if (newPassword !== repeat) { setNotice({ place: "password", message: t("passkey.password_mismatch") }); return; }
          void perform("password", async () => { await securityRequest("change-password", { password: newPassword }); setNewPassword(""); setRepeat(""); setNotice({ place: "password", message: t("passkey.password_changed") }); }); }}>
          <label>{t("passkey.new_password")}<input type="password" autoComplete="new-password" required minLength={12} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
          <label>{t("passkey.repeat_password")}<input type="password" autoComplete="new-password" required minLength={12} value={repeat} onChange={(event) => setRepeat(event.target.value)} /></label>
          <button disabled={disabled} type="submit">{t("passkey.change_password")}</button>
        </form>
        {feedback("password")}
      </section>
    </>}
    <a href="/">{t("auth.continue")}</a>
  </div>;
}
