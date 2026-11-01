"use client";

import { useEffect, useState } from "react";

interface SpikeChecks {
  manifestLoaded: boolean;
  serviceWorkerActive: boolean;
  indexedDbReady: boolean;
  cameraSupported: boolean;
  pushSupported: boolean;
}

export function PwaSpikeClient() {
  const [checks, setChecks] = useState<SpikeChecks>({
    manifestLoaded: false,
    serviceWorkerActive: false,
    indexedDbReady: false,
    cameraSupported: false,
    pushSupported: false
  });
  const [offlineQueueCount, setOfflineQueueCount] = useState<number>(0);
  const [cameraTestMessage, setCameraTestMessage] = useState<string>("მზადაა შესამოწმებლად");

  useEffect(() => {
    fetch("/manifest.webmanifest", { credentials: "include" })
      .then((res) => {
        if (res.ok) {
          setChecks((prev) => ({ ...prev, manifestLoaded: true }));
        }
      })
      .catch(() => undefined);

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.ready
        .then((reg) => {
          if (reg.active) {
            setChecks((prev) => ({ ...prev, serviceWorkerActive: true }));
          }
        })
        .catch(() => undefined);
    }

    if ("indexedDB" in window) {
      const req = window.indexedDB.open("khidi_offline_spike_db", 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("offline_mutations")) {
          db.createObjectStore("offline_mutations", { keyPath: "idempotencyKey" });
        }
      };
      req.onsuccess = () => {
        setChecks((prev) => ({ ...prev, indexedDbReady: true }));
        req.result.close();
      };
    }

    const camSupported = Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    const pushSupported = "PushManager" in window && "Notification" in window;
    setChecks((prev) => ({
      ...prev,
      cameraSupported: camSupported,
      pushSupported
    }));
  }, []);

  function enqueueOfflineTestAction() {
    if (!("indexedDB" in window)) {
      return;
    }
    const req = window.indexedDB.open("khidi_offline_spike_db", 1);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction("offline_mutations", "readwrite");
      const store = tx.objectStore("offline_mutations");
      const idempotencyKey = `idem_${Date.now()}`;
      store.put({
        idempotencyKey,
        action: "SCAN_TEST",
        barcode: "4860001234567",
        createdAt: new Date().toISOString()
      });
      const countReq = store.count();
      countReq.onsuccess = () => {
        setOfflineQueueCount(countReq.result);
      };
      tx.oncomplete = () => db.close();
    };
  }

  async function testCameraPermission() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraTestMessage("ბრაუზერი არ უჭერს მხარს getUserMedia API-ს");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" }
      });
      for (const track of stream.getTracks()) {
        track.stop();
      }
      setCameraTestMessage("✓ კამერაზე წვდომა დადასტურებულია (Permissions-Policy: camera=(self))");
    } catch (err) {
      setCameraTestMessage(
        `კამერის მოთხოვნა შესრულდა (${err instanceof Error ? err.message : "Permission prompt"})`
      );
    }
  }

  return (
    <div style={{ display: "grid", gap: "1.5rem" }}>
      <section
        style={{
          background: "#ffffff",
          border: "1px solid #e2e8f0",
          borderRadius: "12px",
          padding: "1.5rem"
        }}
      >
        <h1 style={{ margin: "0 0 0.5rem 0", fontSize: "1.35rem" }}>
          Access Gateway + PWA Spike დიაგნოსტიკა ([C6], ADR-002)
        </h1>
        <p style={{ margin: "0 0 1.25rem 0", color: "#475569", fontSize: "0.9rem" }}>
          ეს გვერდი ამოწმებს, რომ Access Gateway-ის ქვეშ შეუფერხებლად მუშაობს PWA Manifest (
          <code>crossorigin=&quot;use-credentials&quot;</code>), iOS <code>apple-touch-icon.png</code>,{" "}
          <code>/sw.js</code> Service Worker (მხოლოდ სტატიკური ფაილების ქეშირებით), IndexedDB ოფლაინ რიგი, კამერა და Web Push API.
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "1rem"
          }}
        >
          <div style={{ padding: "1rem", borderRadius: "10px", border: "1px solid #cbd5e1" }}>
            <div style={{ fontSize: "0.8rem", color: "#64748b" }}>1. PWA Manifest Fetch</div>
            <div style={{ fontSize: "1.1rem", fontWeight: 700, marginTop: "0.35rem" }}>
              {checks.manifestLoaded ? "✓ ჩატვირთულია (Credentials OK)" : "მოწმდება..."}
            </div>
          </div>

          <div style={{ padding: "1rem", borderRadius: "10px", border: "1px solid #cbd5e1" }}>
            <div style={{ fontSize: "0.8rem", color: "#64748b" }}>2. Service Worker (/sw.js)</div>
            <div style={{ fontSize: "1.1rem", fontWeight: 700, marginTop: "0.35rem" }}>
              {checks.serviceWorkerActive ? "✓ აქტიურია (Static-only)" : "რეგისტრირდება..."}
            </div>
          </div>

          <div style={{ padding: "1rem", borderRadius: "10px", border: "1px solid #cbd5e1" }}>
            <div style={{ fontSize: "0.8rem", color: "#64748b" }}>3. IndexedDB Offline Queue</div>
            <div style={{ fontSize: "1.1rem", fontWeight: 700, marginTop: "0.35rem" }}>
              {checks.indexedDbReady ? `✓ მზადაა (რიგში: ${offlineQueueCount})` : "მოწმდება..."}
            </div>
          </div>

          <div style={{ padding: "1rem", borderRadius: "10px", border: "1px solid #cbd5e1" }}>
            <div style={{ fontSize: "0.8rem", color: "#64748b" }}>4. Camera &amp; Web Push API</div>
            <div style={{ fontSize: "1.1rem", fontWeight: 700, marginTop: "0.35rem" }}>
              Cam: {checks.cameraSupported ? "✓" : "—"} / Push: {checks.pushSupported ? "✓" : "—"}
            </div>
          </div>
        </div>

        <div style={{ marginTop: "1.25rem", display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
          <button
            type="button"
            onClick={enqueueOfflineTestAction}
            style={{
              padding: "0.65rem 1rem",
              borderRadius: "8px",
              border: "none",
              background: "#15803d",
              color: "#ffffff",
              fontWeight: 700,
              cursor: "pointer"
            }}
          >
            + სატესტო სკანირების ჩაწერა IndexedDB ოფლაინ რიგში
          </button>

          <button
            type="button"
            onClick={testCameraPermission}
            style={{
              padding: "0.65rem 1rem",
              borderRadius: "8px",
              border: "1px solid #0f172a",
              background: "#ffffff",
              color: "#0f172a",
              fontWeight: 700,
              cursor: "pointer"
            }}
          >
            კამერის უფლების შემოწმება (Barcode Scanner Probe)
          </button>
        </div>

        <div style={{ marginTop: "0.75rem", fontSize: "0.85rem", color: "#334155" }}>
          სტატუსი: <strong>{cameraTestMessage}</strong>
        </div>
      </section>
    </div>
  );
}
