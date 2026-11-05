"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { formatStaffName, t } from "@khidi/i18n";
import { OfficeLoginForm } from "./office-login-form.tsx";
import { PasskeySignIn } from "./passkey-sign-in.tsx";
import "./office-login-form.css";

interface LoginFormsProps {
  sharedWarehouseDevice?: boolean;
  registeredDevice: { id: string; deviceName: string } | null;
  pinUsers: { id: string; fullName: string }[];
  quickSignInPreferred?: boolean;
  firstName?: string;
}

export function LoginForms({
  registeredDevice, pinUsers, sharedWarehouseDevice = false, quickSignInPreferred = false, firstName
}: LoginFormsProps) {
  const [view, setView] = useState<"welcome" | "password" | "pin">("welcome");
  const [supportsQuickSignIn, setSupportsQuickSignIn] = useState(quickSignInPreferred);
  const [selectedUserId, setSelectedUserId] = useState(pinUsers.length === 1 ? pinUsers[0]!.id : "");
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinLoading, setPinLoading] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => { setSupportsQuickSignIn(typeof PublicKeyCredential !== "undefined"); }, []);

  function changeView(next: typeof view) {
    setView(next);
    setPin("");
    setPinError(null);
    heading.current?.focus({ preventScroll: true });
  }

  async function clearClientCachesBeforeSwitch() {
    try { navigator.serviceWorker?.controller?.postMessage({ type: "CLEAR_AUTH_CACHES" }); }
    catch { /* Login does not depend on the service worker. */ }
  }

  async function handlePinSubmit(event: FormEvent) {
    event.preventDefault();
    if (pinLoading || !selectedUserId) return;
    setPinError(null);
    setPinLoading(true);

    try {
      await clearClientCachesBeforeSwitch();
      const response = await fetch("/api/auth/warehouse-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ userId: selectedUserId, pin })
      });
      const data = await response.json() as { ok?: boolean; message?: string; redirectTo?: string };
      if (!response.ok || !data.ok) {
        setPinError(data.message ?? t("auth.pin_invalid"));
        return;
      }
      window.location.assign(data.redirectTo ?? "/");
    } catch { setPinError(t("auth.network_error")); }
    finally { setPin(""); setPinLoading(false); }
  }

  const canUsePin = Boolean(registeredDevice && pinUsers.length);
  const personalBrowser = !sharedWarehouseDevice && !registeredDevice;
  const canUseQuickSignIn = personalBrowser && supportsQuickSignIn;
  const quickFirst = canUseQuickSignIn && quickSignInPreferred;
  const greeting = quickFirst && firstName ? t("auth.welcome_name").replace("{name}", () => firstName) : t("auth.welcome");

  return <div className="auth-entry">
    <h1 ref={heading} tabIndex={-1}>{greeting}</h1>
    {view === "welcome" ? <section className="office-login auth-welcome-actions">
      {canUsePin ? <button className="auth-primary" type="button" onClick={() => changeView("pin")}>{t("auth.pin_sign_in")}</button> : null}
      {quickFirst ? <PasskeySignIn primary /> : null}
      <button className={canUsePin || quickFirst ? "auth-secondary" : "auth-primary"} type="button" onClick={() => changeView("password")}>
        {t(canUsePin || quickFirst ? "auth.password_sign_in" : "auth.sign_in")}
      </button>
      {canUseQuickSignIn && !quickFirst ? <PasskeySignIn /> : null}
    </section> : <>
      {view === "password" ? <OfficeLoginForm beforeLogin={clearClientCachesBeforeSwitch} passkeysAllowed={personalBrowser} />
        : <form className="office-login" onSubmit={handlePinSubmit} aria-busy={pinLoading}>
          <h2>{t("auth.pin_sign_in")}</h2>
          {pinError ? <p role="alert" className="auth-error">{pinError}</p> : null}
          <fieldset disabled={pinLoading}>
            <label>{t("auth.pin_user")}
              <select value={selectedUserId} required onChange={(event) => { setSelectedUserId(event.target.value); setPin(""); setPinError(null); }}>
                <option value="" disabled>{t("auth.pin_choose_user")}</option>
                {pinUsers.map((user) => <option key={user.id} value={user.id}>{formatStaffName(user.fullName)}</option>)}
              </select>
            </label>
            <label>{t("auth.pin_code")}
              <input type="password" name="pin" inputMode="numeric" autoComplete="off" required pattern="[0-9]{4,6}" maxLength={6}
                value={pin} onChange={(event) => setPin(event.target.value)} />
            </label>
            <button type="submit" className="auth-primary" disabled={!selectedUserId}>{t(pinLoading ? "auth.checking" : "auth.sign_in")}</button>
          </fieldset>
        </form>}
      <button className="auth-entry-back auth-secondary" type="button" onClick={() => changeView("welcome")} disabled={pinLoading}>{t("auth.login_back")}</button>
    </>}
  </div>;
}
