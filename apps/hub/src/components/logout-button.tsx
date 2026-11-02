"use client";

import { useState } from "react";
import { t } from "@khidi/i18n";

export function LogoutButton() {
  const [loading, setLoading] = useState(false);

  async function handleLogout() {
    setLoading(true);
    try {
      if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: "CLEAR_AUTH_CACHES" });
      }
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch {
      // Ignore cache clear failure
    }

    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin"
    });

    window.location.href = "/login";
  }

  return (
    <button
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
    </button>
  );
}
