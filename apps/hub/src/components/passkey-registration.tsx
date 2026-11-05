"use client";
import { useEffect, useId, useRef, useState } from "react";
import { t } from "@khidi/i18n";
import { classifyPasskeyError, passkeyErrorMessage, passkeyPlatform, SecurityActionError, type PasskeyIssue } from "../lib/passkey-errors.ts";
import { runPasskey } from "../lib/passkey-client.ts";
import { AuthDialog } from "./auth-dialog.tsx";
import { StrongReauthentication } from "./strong-reauthentication.tsx";

export function PasskeyRegistration({ needsTotp, locked, offered = false, onBusyChange, onRegistered }: {
  needsTotp: boolean; locked: boolean; offered?: boolean; onBusyChange: (busy: boolean) => void; onRegistered: () => void;
}) {
  const [rememberName, setRememberName] = useState(false);
  const [phase, setPhase] = useState<"prepare" | "prompt" | "verify" | null>(null);
  const [status, setStatus] = useState(""), [issue, setIssue] = useState<PasskeyIssue | null>(null);
  const [showHelp, setShowHelp] = useState(false), [reauth, setReauth] = useState(false);
  const [platform, setPlatform] = useState<ReturnType<typeof passkeyPlatform>>("other");
  const helpId = useId(), attempt = useRef<AbortController | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  useEffect(() => () => attempt.current?.abort(), []);

  async function register() {
    if (attempt.current || locked || needsTotp || reauth) return;
    const controller = new AbortController();
    attempt.current = controller; onBusyChange(true); setPhase("prepare"); setStatus(""); setIssue(null); setShowHelp(false);
    setPlatform(passkeyPlatform(navigator.userAgent, navigator.maxTouchPoints));
    try {
      await runPasskey("register", { signal: controller.signal, onPhase: setPhase, rememberName });
      setRememberName(false); setStatus(t("passkey.added")); onRegistered();
    } catch (error) {
      const code = classifyPasskeyError(error);
      if (code === "RECENT_AUTH_REQUIRED") { setReauth(true); setStatus(passkeyErrorMessage(error)); }
      else if (code === "CANCELLED") setStatus(passkeyErrorMessage(error));
      else setIssue(code);
    } finally { attempt.current = null; onBusyChange(false); setPhase(null); }
  }

  const title = t(offered ? "passkey.offer_title" : "passkey.enable");
  return <section className="office-login" aria-label={title}>
    {offered ? <h1>{title}</h1> : <h2>{title}</h2>}<p>{t("passkey.device_choice")}</p>
    {needsTotp ? <p><a href="#totp-settings">{t("passkey.enable_totp_first")}</a></p> : null}
    <form className="auth-welcome-actions" onSubmit={(event) => { event.preventDefault(); void register(); }} aria-busy={phase !== null}>
      {!needsTotp ? <label className="quick-name-choice">
        <input type="checkbox" checked={rememberName} onChange={(event) => setRememberName(event.target.checked)} disabled={!!phase || locked} />
        {t("passkey.remember_name")}
      </label> : null}
      <button ref={addButton} className="auth-primary" type="submit" disabled={!!phase || locked || needsTotp || reauth}>{t("passkey.add")}</button>
      {phase && phase !== "verify" ? <button className="auth-secondary" type="button" onClick={() => attempt.current?.abort()}>{t("auth.cancel")}</button> : null}
    </form>
    {offered && !phase ? <a className="auth-secondary auth-later" href="/">{t("passkey.later")}</a> : null}
    <p role="status" className="security-action-status">{phase ? t(phase === "prompt" ? "passkey.prompt" : "auth.checking") : status}</p>
    {reauth ? <StrongReauthentication onSuccess={() => { setReauth(false); setStatus(t("passkey.reauth_done")); }} /> : null}
    {issue ? <AuthDialog title={t("passkey.add_failed")} description={passkeyErrorMessage(new SecurityActionError(issue))} returnFocus={addButton} onClose={() => setIssue(null)}>
      {showHelp ? <p id={helpId}>{t(platform === "android" ? "passkey.help_android" : platform === "ios" ? "passkey.help_ios" : "passkey.help_other")}</p> : null}
      <div className="auth-dialog-actions">
        {(["NOT_COMPLETED", "CONFIGURATION", "UNSUPPORTED", "TIMEOUT"] as PasskeyIssue[]).includes(issue) ? <button className="auth-secondary" type="button" aria-expanded={showHelp} aria-controls={showHelp ? helpId : undefined} onClick={() => setShowHelp(!showHelp)}>{t("passkey.recovery_help")}</button> : null}
        <button className="auth-primary" type="button" disabled={locked} onClick={() => void register()}>{t("passkey.retry")}</button>
        <button className="auth-secondary" type="button" onClick={() => setIssue(null)}>{t("passkey.close")}</button>
      </div>
    </AuthDialog> : null}
  </section>;
}
