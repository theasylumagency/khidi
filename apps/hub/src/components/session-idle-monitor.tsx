"use client";
import { useEffect, useRef, useState } from "react";
import { t } from "@khidi/i18n";
import type { SessionTiming } from "@khidi/auth";
import { monitorSession, type SessionWarning } from "../lib/session-monitor.ts";
import { leaveSession, logoutSession, sessionRequest, SESSION_ACTIVITY_EVENT, SESSION_CHANNEL, SESSION_ENROLLMENT_EVENT } from "../lib/session-client.ts";
import { AuthDialog } from "./auth-dialog.tsx";
import "./office-login-form.css";

export function SessionIdleMonitor({ timing }: { timing: SessionTiming }) {
  const monitor = useRef<ReturnType<typeof monitorSession>>(null);
  const [warning, setWarning] = useState<SessionWarning>(null);
  const [unavailable, setUnavailable] = useState(false), [busy, setBusy] = useState(false);
  const [saveBeforeAbsolute, setSaveBeforeAbsolute] = useState(false);
  useEffect(() => {
    const { sessionId } = timing;
    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(SESSION_CHANNEL) : null;
    const watch = monitorSession(timing, { now: Date.now, request: sessionRequest(sessionId), visible: () => !document.hidden,
      warning: setWarning, unavailable: setUnavailable,
      renewed: () => channel?.postMessage({ sessionId, kind: "renewed" }), ended: () => void leaveSession(sessionId, true) });
    monitor.current = watch;
    const interaction = (event: Event) => { if (event.isTrusted) watch.activity(); };
    const events = ["pointerdown", "click", "keydown", "input", "wheel"];
    for (const event of events) document.addEventListener(event, interaction, { passive: true, capture: true });
    window.addEventListener(SESSION_ACTIVITY_EVENT, watch.activity);
    const refresh = () => watch.refresh();
    const pause = () => { watch.stop(); setWarning(null); channel?.postMessage({ sessionId, kind: "ended" }); };
    window.addEventListener(SESSION_ENROLLMENT_EVENT, pause);
    window.addEventListener("pageshow", refresh); window.addEventListener("online", refresh); window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    if (channel) channel.onmessage = ({ data }) => { if (data?.sessionId === sessionId && (data.kind === "renewed" || data.kind === "ended")) refresh(); };
    refresh();
    return () => {
      watch.stop(); monitor.current = null; channel?.close();
      for (const event of events) document.removeEventListener(event, interaction, true);
      window.removeEventListener(SESSION_ACTIVITY_EVENT, watch.activity); window.removeEventListener(SESSION_ENROLLMENT_EVENT, pause);
      window.removeEventListener("pageshow", refresh); window.removeEventListener("online", refresh); window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [timing]);
  if (!warning) return null;
  if (warning.absolute && saveBeforeAbsolute && !warning.locked) return <p className="auth-expiry-banner" role="status">{t("session.absolute_warning")}</p>;
  return <AuthDialog obscureBackground={warning.locked} title={t(warning.locked ? "session.locked_title" : "session.warning_title")}
    description={t(warning.locked ? "session.locked_body" : warning.absolute ? "session.absolute_warning" : "session.warning_body")}>
    {!warning.locked ? <p aria-hidden="true">{warning.seconds} {t("session.seconds")}</p> : null}
    {unavailable ? <p role="status" className="auth-error">{t("session.unavailable")}</p> : null}
    <div className="auth-dialog-actions">
      {!warning.absolute ? <button type="button" className="auth-primary" disabled={busy} onClick={async () => {
        setBusy(true); try { await monitor.current?.continue(); } finally { setBusy(false); }
      }}>{t(busy ? "auth.checking" : "session.continue")}</button> : null}
      {warning.absolute && !warning.locked ? <button type="button" className="auth-primary" onClick={() => setSaveBeforeAbsolute(true)}>{t("session.return_to_work")}</button> : null}
      <button type="button" className="auth-secondary" disabled={busy} onClick={async () => {
        setBusy(true);
        try { await logoutSession(timing.sessionId); }
        catch { setUnavailable(true); setBusy(false); }
      }}>{t("scanner.logout")}</button>
    </div>
  </AuthDialog>;
}
