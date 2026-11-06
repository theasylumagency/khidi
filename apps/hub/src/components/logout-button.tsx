"use client";

import { useState } from "react";
import { t } from "@khidi/i18n";
import { logoutSession } from "../lib/session-client.ts";

export function LogoutButton({ sessionId }: { sessionId: string }) {
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  async function handleLogout() {
    setLoading(true); setUnavailable(false);
    try { await logoutSession(sessionId); }
    catch { setUnavailable(true); setLoading(false); }
  }

  return (
    <><button
      type="button"
      onClick={handleLogout}
      disabled={loading}
      style={{
        padding: "0.35rem 0.7rem",
        minHeight: "48px",
        borderRadius: "6px",
        background: "#1e293b",
        color: "#f8fafc",
        fontSize: "0.78rem",
        border: "1px solid #334155",
        cursor: loading ? "wait" : "pointer",
        fontWeight: 600
      }}
    >
      {t(loading ? "scanner.logging_out" : "scanner.logout")}
    </button>{unavailable ? <span role="status">{t("session.unavailable")}</span> : null}</>
  );
}
