"use client";

import { useState, type FormEvent } from "react";
import { StrongReauthentication } from "./strong-reauthentication.tsx";
import { t } from "@khidi/i18n";

export function RegisterDeviceButton({ sharedDevice = false }: { sharedDevice?: boolean }) {
  const [deviceName, setDeviceName] = useState("");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reauth, setReauth] = useState(false);

  async function handleRegister(e: FormEvent) {
    e.preventDefault();
    if (!deviceName.trim()) {
      return;
    }
    setLoading(true);
    setStatusMsg(null);
    try {
      const res = await fetch("/api/auth/register-device", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ deviceName: deviceName.trim() })
      });
      const data = (await res.json()) as { ok?: boolean; deviceName?: string; message?: string; error?: string };
      if (!res.ok || !data.ok) {
        if (data.error === "RECENT_AUTH_REQUIRED") setReauth(true);
        setStatusMsg(`შეცდომა: ${data.message ?? "რეგისტრაცია ვერ მოხერხდა"}`);
        return;
      }
      setStatusMsg(`✓ მოწყობილობა "${data.deviceName}" დარეგისტრირდა და მიება ამ ბრაუზერს!`);
      setDeviceName("");
      window.location.reload();
    } catch {
      setStatusMsg("ქსელური შეცდომა მოწყობილობის რეგისტრაციისას.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div><form
      onSubmit={handleRegister}
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "0.6rem",
        alignItems: "center",
        marginTop: "0.75rem"
      }}
    >
      <input
        type="text"
        required
        minLength={2}
        value={deviceName}
        onChange={(e) => setDeviceName(e.target.value)}
        placeholder="მაგ: საწყობის ტელეფონი #2"
        style={{
          padding: "0.5rem 0.75rem",
          borderRadius: "8px",
          border: "1px solid #cbd5e1",
          fontSize: "0.85rem",
          minWidth: "240px"
        }}
      />
      <button
        type="submit"
        disabled={loading}
        style={{
          padding: "0.55rem 0.9rem",
          borderRadius: "8px",
          border: "none",
          background: "#15803d",
          color: "#ffffff",
          fontWeight: 700,
          fontSize: "0.85rem",
          cursor: loading ? "wait" : "pointer"
        }}
      >
        {loading ? "რეგისტრაცია..." : "ამ მოწყობილობის რეგისტრაცია საწყობის ტერმინალად"}
      </button>
      {statusMsg && (
        <span style={{ fontSize: "0.82rem", fontWeight: 600, color: "#166534" }}>{statusMsg}</span>
      )}
    </form>{reauth ? <StrongReauthentication sharedDevice={sharedDevice} onSuccess={() => { setReauth(false); setStatusMsg(t("passkey.reauth_done")); }} /> : null}</div>
  );
}
