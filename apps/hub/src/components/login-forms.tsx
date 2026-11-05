"use client";

import { useState, type FormEvent } from "react";
import type { UserRole } from "@khidi/shared";
import { OfficeLoginForm } from "./office-login-form.tsx";

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
        gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))",
        gap: "1.5rem"
      }}
    >
      <OfficeLoginForm beforeLogin={clearClientCachesBeforeSwitch} />

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
