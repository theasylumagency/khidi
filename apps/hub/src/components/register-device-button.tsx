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
      className="hub-form-row"
    >
      <input
        type="text"
        required
        minLength={2}
        value={deviceName}
        onChange={(e) => setDeviceName(e.target.value)}
        placeholder="მაგ: საწყობის ტელეფონი #2"
      />
      <button
        type="submit"
        disabled={loading}
      >
        {loading ? "რეგისტრაცია..." : "ამ მოწყობილობის რეგისტრაცია საწყობის ტერმინალად"}
      </button>
      {statusMsg && (
        <span style={{ fontSize: "0.82rem", fontWeight: 600, color: "#166534" }}>{statusMsg}</span>
      )}
    </form>{reauth ? <StrongReauthentication sharedDevice={sharedDevice} onSuccess={() => { setReauth(false); setStatusMsg(t("passkey.reauth_done")); }} /> : null}</div>
  );
}
