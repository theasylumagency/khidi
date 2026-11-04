import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const origin = "https://khidi.example", script = readFileSync(fileURLToPath(new URL("../../public/sw.js", import.meta.url)), "utf8");
function worker() {
  const handlers = new Map<string, (event: unknown) => void>();
  const stores = new Map<string, Map<string, Response>>();
  const key = (request: Request | string) => typeof request === "string" ? new URL(request, origin).href : request.url;
  const network = vi.fn(async () => new Response("current origin asset"));
  const claim = vi.fn(async () => {}), skipWaiting = vi.fn();
  const caches = {
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name)!;
      return {
        addAll: async (urls: string[]) => { for (const url of urls) store.set(key(url), new Response("bootstrap asset")); },
        put: async (request: Request | string, response: Response) => { store.set(key(request), response.clone()); }
      };
    },
    // CacheStorage deliberately ignores HTTP freshness, just like the browser API.
    match: vi.fn(async (request: Request | string) => {
      for (const store of stores.values()) { const hit = store.get(key(request)); if (hit) return hit.clone(); }
      return undefined;
    })
  };
  runInNewContext(script, { self: { location: new URL(origin), clients: { claim }, skipWaiting,
    addEventListener: (name: string, handler: (event: unknown) => void) => handlers.set(name, handler) }, caches, fetch: network, URL });
  async function lifecycle(name: string, data?: unknown) {
    const pending: Promise<unknown>[] = [];
    handlers.get(name)!({ data, waitUntil: (promise: Promise<unknown>) => pending.push(promise) });
    await Promise.all(pending);
  }
  async function request(path: string, options: { method?: string; mode?: string; accept?: string } = {}) {
    const request = { url: new URL(path, origin).href, method: options.method ?? "GET", mode: options.mode ?? "cors", headers: new Headers({ accept: options.accept ?? "*/*" }) };
    let intercepted: Promise<Response> | undefined;
    handlers.get("fetch")!({ request, respondWith: (promise: Promise<Response>) => { intercepted = promise; } });
    const response = await (intercepted ?? network());
    return { intercepted: !!intercepted, body: await response.text() };
  }
  return { request, lifecycle, stores, caches, network, claim, skipWaiting };
}
describe("PWA runtime asset hydration safety", () => {
  it.each([
    "/_next/static/chunks/workspace_i18n.js", "/_next/static/css/scanner.css",
    "/_next/static/development/_buildManifest.js", "/_next/static/chunks/[turbopack]_hmr.js?version=1"
  ])("lets Next/HTTP control mutable runtime assets even with a stale v2 entry: %s", async (path) => {
    const runtime = worker();
    runtime.stores.set("khidi-static-v2", new Map([[new URL(path, origin).href, new Response("old dictionary without scanner key", { headers: { "Cache-Control": "no-cache, must-revalidate" } })]]));
    expect(await runtime.request(path)).toEqual({ intercepted: false, body: "current origin asset" });
    expect(runtime.caches.match).not.toHaveBeenCalled();
    expect(runtime.network).toHaveBeenCalledOnce();
  });
  it("retains cached bootstrap icons and manifest for offline use", async () => {
    const runtime = worker(); await runtime.lifecycle("install");
    runtime.network.mockRejectedValue(new Error("offline"));
    for (const path of ["/icons/icon-192.png", "/manifest.webmanifest"]) {
      expect(await runtime.request(path)).toEqual({ intercepted: true, body: "bootstrap asset" });
    }
    expect(runtime.network).not.toHaveBeenCalled();
  });
  it("activates a new cache generation and removes legacy runtime bundles", async () => {
    const runtime = worker(); runtime.stores.set("khidi-static-v2", new Map());
    await runtime.lifecycle("install"); await runtime.lifecycle("activate");
    expect(runtime.stores.has("khidi-static-v2")).toBe(false);
    expect(runtime.stores.size).toBe(1); expect([...runtime.stores.values()][0]!.size).toBe(7);
    expect(runtime.claim).toHaveBeenCalledOnce(); expect(runtime.skipWaiting).toHaveBeenCalledOnce();
  });
  it("does not intercept documents, RSC/API responses, writes or another origin", async () => {
    const runtime = worker();
    for (const [path, options] of [
      ["/warehouse/tasks/example", { mode: "navigate" }], ["/warehouse/tasks/example?_rsc=123", {}],
      ["/api/scanning/session", {}], ["/api/media/uploads", { method: "POST" }],
      ["/icons/login-redirect.png", { accept: "text/html" }], ["https://other.example/icons/icon.png", {}]
    ] as const) expect((await runtime.request(path, options)).intercepted).toBe(false);
    expect(runtime.caches.match).not.toHaveBeenCalled();
  });
  it("preserves the existing explicit logout-cache purge and bootstrap refill", async () => {
    const runtime = worker(); await runtime.lifecycle("install");
    runtime.stores.set("khidi-static-v2", new Map());
    await runtime.lifecycle("message", { type: "CLEAR_AUTH_CACHES" });
    expect(runtime.stores.has("khidi-static-v2")).toBe(false);
    expect(runtime.stores.size).toBe(1);
    expect((await runtime.request("/manifest.webmanifest")).body).toBe("bootstrap asset");
  });
});
