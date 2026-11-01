// Khidi Service Worker (Milestone 1 Access Gateway Spike [C6])
// SECURITY RULE: Never cache HTML documents, navigation requests, or /api/* responses.
// Shared warehouse phones switch users via PIN; only static assets may be cached,
// and CLEAR_AUTH_CACHES purges caches on logout or user switch.

const CACHE_NAME = "khidi-static-v2";
const STATIC_PRECACHE_URLS = [
  "/manifest.webmanifest",
  "/icons/apple-touch-icon.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/icon-192.svg",
  "/icons/icon-512.svg"
];

function isCacheableStaticAsset(url) {
  return (
    url.pathname === "/manifest.webmanifest" ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/_next/static/")
  );
}

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_PRECACHE_URLS))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  // Never cache navigation/HTML requests or API routes
  const acceptHeader = event.request.headers.get("accept") || "";
  if (
    event.request.mode === "navigate" ||
    acceptHeader.includes("text/html")
  ) {
    return;
  }

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !isCacheableStaticAsset(url)) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        return cached;
      }
      return fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "CLEAR_AUTH_CACHES") {
    event.waitUntil(
      caches
        .keys()
        .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
        .then(() =>
          caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_PRECACHE_URLS))
        )
    );
  }
});

// Web Push Notification handler (§14, [C6])
self.addEventListener("push", (event) => {
  let payload = {
    title: "Khidi",
    body: "ახალი სასაწყობო დავალება",
    url: "/tasks"
  };

  if (event.data) {
    try {
      payload = { ...payload, ...event.data.json() };
    } catch {
      payload.body = event.data.text();
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: payload.url }
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ("focus" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
