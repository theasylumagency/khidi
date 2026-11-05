"use client";
import { useEffect, useId, useRef, useState } from "react";
import { t } from "@khidi/i18n";
import { classifyPasskeyError, passkeyErrorMessage, passkeyPlatform, SecurityActionError, type PasskeyIssue } from "../lib/passkey-errors.ts";
import { runPasskey } from "../lib/passkey-client.ts";
import { AuthDialog } from "./auth-dialog.tsx";
import { StrongReauthentication } from "./strong-reauthentication.tsx";

export function PasskeyRegistration({ needsTotp, locked, onBusyChange, onRegistered }: {
  needsTotp: boolean; locked: boolean; onBusyChange: (busy: boolean) => void; onRegistered: () => void;
}) {
  const [name, setName] = useState(""), [phase, setPhase] = useState<"prepare" | "prompt" | "verify" | null>(null);
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
      await runPasskey("register", name.trim() || t("passkey.default_name"), { signal: controller.signal, onPhase: setPhase });
      setName(""); setStatus(t("passkey.added")); onRegistered();
    } catch (error) {
      const code = classifyPasskeyError(error);
      if (code === "RECENT_AUTH_REQUIRED") { setReauth(true); setStatus(passkeyErrorMessage(error)); }
      else if (code === "CANCELLED") setStatus(passkeyErrorMessage(error));
      else setIssue(code);
    } finally { attempt.current = null; onBusyChange(false); setPhase(null); }
  }

  return <section className="office-login" aria-label={t("passkey.enable")}>
    <h2>{t("passkey.enable")}</h2><p>{t("passkey.device_choice")}</p>
    {needsTotp ? <p><a href="#totp-settings">{t("passkey.enable_totp_first")}</a></p> : null}
    <form onSubmit={(event) => { event.preventDefault(); void register(); }} aria-busy={phase !== null}>
      <label>{t("passkey.name")}<input maxLength={100} value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" /></label>
      <button ref={addButton} className="auth-primary" type="submit" disabled={!!phase || locked || needsTotp || reauth}>{t("passkey.add")}</button>
      {phase && phase !== "verify" ? <button className="auth-secondary" type="button" onClick={() => attempt.current?.abort()}>{t("auth.cancel")}</button> : null}
    </form>
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
