"use client";

import React, { useState } from "react";

interface CheckStatus {
  status: "IDLE" | "PASS" | "FAIL";
  detail: string;
}

export default function PwaSpikePage() {
  const [manifestCheck, setManifestCheck] = useState<CheckStatus>({
    status: "IDLE",
    detail: "არ არის გაშვებული"
  });
  const [swCheck, setSwCheck] = useState<CheckStatus>({
    status: "IDLE",
    detail: "არ არის გაშვებული"
  });
  const [idbCheck, setIdbCheck] = useState<CheckStatus>({
    status: "IDLE",
    detail: "არ არის გაშვებული"
  });
  const [cameraCheck, setCameraCheck] = useState<CheckStatus>({
    status: "IDLE",
    detail: "არ არის გაშვებული"
  });
  const [pushCheck, setPushCheck] = useState<CheckStatus>({
    status: "IDLE",
    detail: "არ არის გაშვებული"
  });

  async function verifyManifestAndIcons() {
    try {
      const res = await fetch("/manifest.webmanifest", { credentials: "include" });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const manifest = await res.json();
      setManifestCheck({
        status: "PASS",
        detail: `Manifest ჩაიტვირთა (${manifest.short_name}, icons: ${manifest.icons?.length ?? 0})`
      });
    } catch (err) {
      setManifestCheck({
        status: "FAIL",
        detail: err instanceof Error ? err.message : String(err)
      });
    }
  }

  async function verifyServiceWorker() {
    try {
      if (!("serviceWorker" in navigator)) {
        throw new Error("Service Worker არ არის მხარდაჭერილი ამ ბრაუზერში");
      }
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      setSwCheck({
        status: "PASS",
        detail: `Service Worker აქტიურია (scope: ${reg.scope})`
      });
    } catch (err) {
      setSwCheck({
        status: "FAIL",
        detail: err instanceof Error ? err.message : String(err)
      });
    }
  }

  async function verifyIndexedDbQueue() {
    try {
      const dbName = "agrotrade_offline_spike_db";
      const storeName = "offline_queue";
      const testKey = `idemp_${Date.now()}`;

      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open(dbName, 1);
        req.onupgradeneeded = () => {
          req.result.createObjectStore(storeName, { keyPath: "idempotencyKey" });
        };
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(storeName, "readwrite");
          const store = tx.objectStore(storeName);
          store.put({ idempotencyKey: testKey, scannedCode: "AGT-000184", createdAt: Date.now() });
          tx.oncomplete = () => {
            const readTx = db.transaction(storeName, "readonly");
            const getReq = readTx.objectStore(storeName).get(testKey);
            getReq.onsuccess = () => {
              db.close();
              if (getReq.result?.idempotencyKey === testKey) {
                resolve();
              } else {
                reject(new Error("IndexedDB ჩანაწერი ვერ წაიკითხა"));
              }
            };
          };
          tx.onerror = () => reject(tx.error);
        };
      });

      setIdbCheck({
        status: "PASS",
        detail: `IndexedDB ჩაწერა/წაკითხვა წარმატებულია (key: ${testKey})`
      });
    } catch (err) {
      setIdbCheck({
        status: "FAIL",
        detail: err instanceof Error ? err.message : String(err)
      });
    }
  }

  async function verifyCameraAndBarcode() {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("mediaDevices.getUserMedia არ არის ხელმისაწვდომი (საჭიროა HTTPS)");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" }
      });
      stream.getTracks().forEach((track) => track.stop());
      const hasNativeBarcode = "BarcodeDetector" in window;
      setCameraCheck({
        status: "PASS",
        detail: `კამერის ნებართვა მიღებულია (Native BarcodeDetector: ${hasNativeBarcode ? "დიახ" : "ZXing fallback"})`
      });
    } catch (err) {
      setCameraCheck({
        status: "FAIL",
        detail: err instanceof Error ? err.message : String(err)
      });
    }
  }

  async function verifyWebPushNotification() {
    try {
      if (!("Notification" in window)) {
        throw new Error("Web Notifications არ არის მხარდაჭერილი");
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        throw new Error(`ნებართვის სტატუსი: ${permission}`);
      }
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification("AgroTrade Hub — სატესტო შეტყობინება [C6]", {
        body: "Gateway + PWA Web Push ტესტი წარმატებით შესრულდა.",
        icon: "/icons/icon-192.svg"
      });
      setPushCheck({
        status: "PASS",
        detail: "სატესტო შეტყობინება გაიგზავნა Service Worker-ის გავლით"
      });
    } catch (err) {
      setPushCheck({
        status: "FAIL",
        detail: err instanceof Error ? err.message : String(err)
      });
    }
  }

  const rows = [
    {
      title: "1. Manifest & Icons (crossorigin=use-credentials)",
      state: manifestCheck,
      action: verifyManifestAndIcons
    },
    {
      title: "2. Service Worker Registration (/sw.js)",
      state: swCheck,
      action: verifyServiceWorker
    },
    {
      title: "3. IndexedDB Offline Queue Write/Read",
      state: idbCheck,
      action: verifyIndexedDbQueue
    },
    {
      title: "4. Camera Permission & BarcodeDetector Check",
      state: cameraCheck,
      action: verifyCameraAndBarcode
    },
    {
      title: "5. Web Push / Service Worker Notification",
      state: pushCheck,
      action: verifyWebPushNotification
    }
  ];

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <section
        style={{
          backgroundColor: "#ffffff",
          border: "1px solid #cbd5e1",
          borderRadius: "6px",
          padding: "1.25rem"
        }}
      >
        <h1 style={{ marginTop: 0, fontSize: "1.25rem" }}>
          Access Gateway + PWA Verification Spike (§16.3, C6, ADR-002)
        </h1>
        <p style={{ color: "#475569", fontSize: "0.9rem" }}>
          გახსენით ეს გვერდი რეალურ Android ტელეფონსა და iPhone-ზე Access Gateway-ს უკან და შეამოწმეთ ხუთივე კომპონენტი.
        </p>

        <div style={{ display: "grid", gap: "0.75rem", marginTop: "1rem" }}>
          {rows.map((row) => (
            <div
              key={row.title}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: "0.75rem",
                padding: "0.85rem",
                border: "1px solid #e2e8f0",
                borderRadius: "6px",
                backgroundColor: "#f8fafc"
              }}
            >
              <div>
                <div style={{ fontWeight: 600 }}>{row.title}</div>
                <div style={{ fontSize: "0.85rem", color: "#475569", marginTop: "0.2rem" }}>
                  სტატუსი: <strong>{row.state.status}</strong> — {row.state.detail}
                </div>
              </div>
              <button
                type="button"
                onClick={row.action}
                style={{
                  backgroundColor: "#0f172a",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "6px",
                  padding: "0.65rem 1rem",
                  fontSize: "0.9rem",
                  fontWeight: 600,
                  cursor: "pointer"
                }}
              >
                შემოწმება
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
