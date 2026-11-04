"use client";

import { useState, type FormEvent } from "react";
import { t } from "@khidi/i18n";
import { TotpEnrollmentSetup, copyTotpSetupKey, type TotpEnrollment } from "./totp-enrollment.tsx";
import "./office-login-form.css";

export function OfficeLoginForm({ beforeLogin }: { beforeLogin(): Promise<void> }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const [confirmRestart, setConfirmRestart] = useState(false);

  async function signIn(restartEnrollment = false) {
    if (loading) return;
    setLoading(true); setError(null);
    try {
      await beforeLogin();
      const response = await fetch("/api/auth/office-login", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", cache: "no-store",
        body: JSON.stringify({ email, password, totpCode: restartEnrollment ? undefined : code.trim() || undefined, restartEnrollment })
      });
      const data = await response.json() as { ok?: boolean; enrollment?: TotpEnrollment; message?: string };
      if (!response.ok || !data.ok) { setError(data.message ?? t("auth.login_failed")); return; }
      if (data.enrollment) {
        setEnrollment(data.enrollment); setCode(""); setStep(1); setCopyNotice(null); setConfirmRestart(false); return;
      }
      const wasEnrolling = enrollment !== null;
      // No browser persistence; release the setup secret and credentials before continuing.
      setEnrollment(null); setPassword(""); setCode(""); setCopyNotice(null); setConfirmRestart(false);
      if (wasEnrolling) setStep(3);
      else window.location.assign("/");
    } catch { setError(t("auth.network_error")); }
    finally { setLoading(false); }
  }

  function submit(event: FormEvent) { event.preventDefault(); void signIn(); }
  async function copyKey() {
    if (!enrollment) return;
    try { await copyTotpSetupKey(enrollment, (value) => navigator.clipboard.writeText(value)); setCopyNotice(t("auth.key_copied")); }
    catch { setCopyNotice(t("auth.copy_failed")); }
  }

  return <form className="office-login" onSubmit={submit} aria-busy={loading}>
    <h2>{enrollment || step === 3 ? t("auth.enroll_title") : t("auth.office_title")}</h2>
    {enrollment || step === 3 ? <ol className="totp-steps" aria-label={t("auth.enroll_steps")}>
      {[t("auth.enroll_add"), t("auth.enroll_verify"), t("auth.enroll_done")].map((label, index) =>
        <li key={label} aria-current={step === index + 1 ? "step" : undefined}>{index + 1}. {label}</li>)}
    </ol> : <p className="auth-help">{t("auth.office_help")}</p>}
    {error ? <p className="auth-error" role="alert">{error}</p> : null}
    {step === 3 ? <div>
      <p role="status">{t("auth.enrollment_complete")}</p>
      <a className="auth-primary" href="/">{t("auth.continue")}</a>
    </div> : <fieldset disabled={loading}>
      {!enrollment ? <>
        <label>{t("auth.email")}<input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>{t("auth.password")}<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      </> : null}
      {enrollment && step === 1 ? <>
        <TotpEnrollmentSetup enrollment={enrollment} onCopy={() => void copyKey()} copyNotice={copyNotice} />
        <button className="auth-primary" type="button" onClick={() => { setStep(2); setError(null); }}>{t("auth.ready_to_confirm")}</button>
        {confirmRestart ? <div className="auth-restart-confirm" role="group" aria-label={t("auth.restart_enrollment")}>
          <p>{t("auth.restart_warning")}</p>
          <button type="button" onClick={() => void signIn(true)}>{t("auth.confirm_restart")}</button>
          <button type="button" onClick={() => setConfirmRestart(false)}>{t("auth.cancel")}</button>
        </div> : <button className="auth-secondary" type="button" onClick={() => setConfirmRestart(true)}>{t("auth.restart_enrollment")}</button>}
      </> : <>
        {enrollment ? <p>{t("auth.enroll_confirm")}</p> : null}
        <label>{t("auth.totp_code")}<input type="text" inputMode="numeric" pattern="[0-9]{6}" maxLength={6}
          required={enrollment !== null} autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} /></label>
        <button className="auth-primary" type="submit">{loading ? t("auth.checking") : enrollment ? t("auth.confirm_code") : t("auth.sign_in")}</button>
        {enrollment ? <button className="auth-secondary" type="button" onClick={() => { setStep(1); setError(null); }}>{t("auth.back_to_setup")}</button> : null}
      </>}
    </fieldset>}
  </form>;
}
