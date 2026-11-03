"use client";

import { useState, type FormEvent } from "react";
import type { UserRole } from "@khidi/shared";
import { t } from "@khidi/i18n";

interface PinUserOption {
  id: string;
  fullName: string;
  role: UserRole;
}

interface LoginFormsProps {
  registeredDevice: { id: string; deviceName: string } | null;
  pinUsers: PinUserOption[];
}

export function LoginForms({ registeredDevice, pinUsers }: LoginFormsProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [officeError, setOfficeError] = useState<string | null>(null);
  const [officeLoading, setOfficeLoading] = useState(false);
  const [enrollment, setEnrollment] = useState<{ base32Secret: string; otpauthUri: string } | null>(null);

  const [selectedUserId, setSelectedUserId] = useState<string>(pinUsers[0]?.id ?? "");
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinLoading, setPinLoading] = useState(false);

  async function clearClientCachesBeforeSwitch() {
    try {
      if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: "CLEAR_AUTH_CACHES" });
      }
    } catch {
      // Ignore
    }
  }

  async function handleOfficeSubmit(e: FormEvent) {
    e.preventDefault();
    setOfficeError(null);
    setOfficeLoading(true);

    try {
      await clearClientCachesBeforeSwitch();
      const res = await fetch("/api/auth/office-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          email,
          password,
          totpCode: totpCode.trim() || undefined
        })
      });

      const data = (await res.json()) as { ok?: boolean; message?: string; redirectTo?: string; enrollment?: { base32Secret: string; otpauthUri: string } };
      if (!res.ok || !data.ok) {
        setOfficeError(data.message ?? "ავტორიზაცია ვერ მოხერხდა.");
        return;
      }

      if (data.enrollment) { setEnrollment(data.enrollment); setTotpCode(""); return; }
      setEnrollment(null); setPassword("");
      window.location.href = data.redirectTo ?? "/";
    } catch {
      setOfficeError("ქსელური შეცდომა ავტორიზაციისას.");
    } finally {
      setOfficeLoading(false);
    }
  }

  async function handlePinSubmit(e: FormEvent) {
    e.preventDefault();
    setPinError(null);
    setPinLoading(true);

    try {
      await clearClientCachesBeforeSwitch();
      const res = await fetch("/api/auth/warehouse-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          userId: selectedUserId,
          pin
        })
      });

      const data = (await res.json()) as { ok?: boolean; message?: string; redirectTo?: string };
      if (!res.ok || !data.ok) {
        setPinError(data.message ?? "PIN კოდი არასწორია.");
        return;
      }

      window.location.href = data.redirectTo ?? "/";
    } catch {
      setPinError("ქსელური შეცდომა PIN ავტორიზაციისას.");
    } finally {
      setPinLoading(false);
    }
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
        gap: "1.5rem"
      }}
    >
      {/* 1. Office Login */}
      <form
        onSubmit={handleOfficeSubmit}
        style={{
          background: "#ffffff",
          border: "1px solid #e2e8f0",
          borderRadius: "12px",
          padding: "1.5rem"
        }}
      >
        <div
          style={{
            display: "inline-block",
            background: "#dbeafe",
            color: "#1e40af",
            padding: "0.2rem 0.6rem",
            borderRadius: "999px",
            fontSize: "0.75rem",
            fontWeight: 700,
            marginBottom: "0.75rem"
          }}
        >
          OFFICE_PASSWORD_TOTP
        </div>
        <h2 style={{ margin: "0 0 0.5rem 0", fontSize: "1.15rem" }}>
          ოფისის შესვლა (ელ-ფოსტა + პაროლი + TOTP)
        </h2>
        <p style={{ margin: "0 0 1rem 0", fontSize: "0.85rem", color: "#64748b" }}>
          <code>ADMIN</code> და <code>STOCK_MANAGER</code> როლებისთვის TOTP 2FA სავალდებულოა (დაშიფრულია AES-256-GCM-ით). 5 არასწორი მცდელობის შემდეგ ანგარიში იბლოკება 15 წუთით.
        </p>

        {officeError && (
          <div
            style={{
              background: "#fef2f2",
              border: "1px solid #fecaca",
              color: "#991b1b",
              padding: "0.65rem",
              borderRadius: "8px",
              fontSize: "0.85rem",
              marginBottom: "0.9rem",
              fontWeight: 600
            }}
          >
            {officeError}
          </div>
        )}

        <div style={{ display: "grid", gap: "0.85rem" }}>
          <label style={{ display: "grid", gap: "0.3rem", fontSize: "0.85rem", fontWeight: 600 }}>
            ელ-ფოსტა
            <input
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setEnrollment(null); setTotpCode(""); }}
              placeholder="name@company.ge"
              style={{
                padding: "0.65rem",
                borderRadius: "8px",
                border: "1px solid #cbd5e1",
                fontSize: "0.95rem"
              }}
            />
          </label>
          <label style={{ display: "grid", gap: "0.3rem", fontSize: "0.85rem", fontWeight: 600 }}>
            პაროლი
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setEnrollment(null); setTotpCode(""); }}
              style={{
                padding: "0.65rem",
                borderRadius: "8px",
                border: "1px solid #cbd5e1",
                fontSize: "0.95rem"
              }}
            />
          </label>
          <label style={{ display: "grid", gap: "0.3rem", fontSize: "0.85rem", fontWeight: 600 }}>
            {t("auth.totp_code")}
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              autoComplete="one-time-code"
              maxLength={6}
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value)}
              placeholder="000000"
              style={{
                padding: "0.65rem",
                borderRadius: "8px",
                border: "1px solid #cbd5e1",
                fontSize: "1.1rem",
                letterSpacing: "0.2em",
                fontFamily: "monospace"
              }}
            />
          </label>
          {enrollment ? <aside role="status">
            <h3>{t("auth.enroll_title")}</h3><p>{t("auth.enroll_help")}</p>
            <p><code style={{ overflowWrap: "anywhere" }}>{enrollment.base32Secret}</code></p>
            <a href={enrollment.otpauthUri}>{t("auth.open_authenticator")}</a>
            <p>{t("auth.enroll_confirm")}</p>
          </aside> : null}
          <button
            type="submit"
            disabled={officeLoading}
            style={{
              marginTop: "0.4rem",
              padding: "0.75rem",
              borderRadius: "8px",
              border: "none",
              background: "#0f172a",
              color: "#ffffff",
              fontWeight: 700,
              fontSize: "0.95rem",
              cursor: officeLoading ? "wait" : "pointer"
            }}
          >
            {officeLoading ? "მოწმდება..." : "ოფისის სესიით შესვლა"}
          </button>
        </div>
      </form>

      {/* 2. Warehouse Shared Phone PIN Switcher */}
      <div
        style={{
          background: "#0f172a",
          color: "#f8fafc",
          border: "2px solid #22c55e",
          borderRadius: "12px",
          padding: "1.5rem"
        }}
      >
        <div
          style={{
            display: "inline-block",
            background: "#14532d",
            color: "#bbf7d0",
            padding: "0.2rem 0.6rem",
            borderRadius: "999px",
            fontSize: "0.75rem",
            fontWeight: 700,
            marginBottom: "0.75rem"
          }}
        >
          WAREHOUSE_PIN (საწყობის რეგისტრირებული ტელეფონი)
        </div>
        <h2 style={{ margin: "0 0 0.5rem 0", fontSize: "1.15rem" }}>
          საწყობის სწრაფი გადართვა (პირადი PIN)
        </h2>

        {!registeredDevice ? (
          <div
            style={{
              background: "#1e293b",
              border: "1px solid #334155",
              borderRadius: "8px",
              padding: "1rem",
              fontSize: "0.85rem",
              color: "#cbd5e1",
              lineHeight: 1.5
            }}
          >
            ეს ბრაუზერი/ტელეფონი ჯერ არ არის რეგისტრირებული საწყობის ტერმინალად.
            <br />
            <br />
            საწყობის PIN გადამრთველის გასააქტიურებლად ჯერ შედით <code>ADMIN</code> ანგარიშით და{" "}
            <strong>მომხმარებლების</strong> გვერდზე დააჭირეთ{" "}
            <em>„ამ მოწყობილობის რეგისტრაცია საწყობის ტერმინალად“</em>.
          </div>
        ) : (
          <form onSubmit={handlePinSubmit} style={{ display: "grid", gap: "0.8rem" }}>
            <div style={{ fontSize: "0.8rem", color: "#86efac" }}>
              ✓ რეგისტრირებული ტერმინალი: <strong>{registeredDevice.deviceName}</strong>
            </div>

            {pinError && (
              <div
                style={{
                  background: "#450a0a",
                  border: "1px solid #ef4444",
                  color: "#fecaca",
                  padding: "0.65rem",
                  borderRadius: "8px",
                  fontSize: "0.85rem",
                  fontWeight: 600
                }}
              >
                {pinError}
              </div>
            )}

            <div style={{ display: "grid", gap: "0.5rem" }}>
              {pinUsers.map((u) => {
                const selected = u.id === selectedUserId;
                return (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => setSelectedUserId(u.id)}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "0.75rem",
                      background: selected ? "#14532d" : "#1e293b",
                      border: selected ? "2px solid #22c55e" : "1px solid #334155",
                      borderRadius: "8px",
                      color: "#f8fafc",
                      cursor: "pointer",
                      textAlign: "left"
                    }}
                  >
                    <span style={{ fontWeight: 700 }}>{u.fullName}</span>
                    <span style={{ fontSize: "0.78rem", color: "#86efac" }}>{u.role}</span>
                  </button>
                );
              })}
            </div>

            <label style={{ display: "grid", gap: "0.3rem", fontSize: "0.85rem", fontWeight: 600 }}>
              პირადი PIN კოდი (4–6 ციფრი)
              <input
                type="password"
                inputMode="numeric"
                required
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="••••"
                style={{
                  padding: "0.75rem",
                  borderRadius: "8px",
                  border: "1px solid #475569",
                  background: "#020617",
                  color: "#ffffff",
                  fontSize: "1.25rem",
                  letterSpacing: "0.3em",
                  textAlign: "center"
                }}
              />
            </label>

            <button
              type="submit"
              disabled={pinLoading || !selectedUserId}
              style={{
                padding: "0.85rem",
                borderRadius: "8px",
                border: "none",
                background: "#16a34a",
                color: "#ffffff",
                fontWeight: 700,
                fontSize: "1rem",
                cursor: pinLoading ? "wait" : "pointer"
              }}
            >
              {pinLoading ? "მოწმდება..." : "PIN-ით სწრაფი შესვლა"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
