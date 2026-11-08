import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "../proxy.ts";
import { verifiedProxyClientIp } from "./host-isolation.ts";
import { GET as health } from "../app/api/health/route.ts";
const state=vi.hoisted(()=>({headers:new Headers(),cookies:vi.fn(async()=>({get:()=>undefined}))}));
vi.mock("next/headers",()=>({headers:async()=>state.headers,cookies:state.cookies}));
vi.mock("next/navigation",()=>({notFound:()=>{throw new Error("NOT_FOUND_HOST");},redirect:()=>{throw new Error("REDIRECT");}}));
import { getCurrentPrincipal, requirePageAuth } from "./session.ts";
afterEach(()=>{vi.unstubAllEnvs();state.cookies.mockClear();});
it("isolates both hosts before cookie checks, including login, health and API endpoints",async()=>{
  vi.stubEnv("KHIDI_API_HOST","api.example.test");
  for(const path of ["/login","/products","/api/health","/api/auth/office-login","/manifest.webmanifest"])
    expect(proxy(new NextRequest("http://api.example.test"+path)).status).toBe(404);
  expect(proxy(new NextRequest("http://app.example.test/api/v1/storefront/a/products")).status).toBe(404);
  expect(proxy(new NextRequest("http://api.example.test/api/v1/storefront/a/products")).headers.get("x-middleware-next")).toBe("1");
  expect((await health(new Request("http://api.example.test/api/health"))).status).toBe(404);
  state.headers=new Headers({host:"api.example.test"});
  await expect(getCurrentPrincipal()).rejects.toThrow("NOT_FOUND_HOST");
  await expect(requirePageAuth()).rejects.toThrow("NOT_FOUND_HOST");
  expect(state.cookies).not.toHaveBeenCalled();
});
it("accepts client IP only from a proxy holding the configured token",()=>{
  const env={NODE_ENV:"test" as const,KHIDI_PROXY_TOKEN:"x".repeat(32)};
  expect(verifiedProxyClientIp(new Request("http://api.example.test",{headers:{"x-khidi-client-ip":"192.0.2.10","x-forwarded-for":"192.0.2.10"}}),env)).toBeUndefined();
  expect(verifiedProxyClientIp(new Request("http://api.example.test",{headers:{"x-khidi-client-ip":"192.0.2.10","x-khidi-proxy-token":env.KHIDI_PROXY_TOKEN}}),env)).toBe("192.0.2.10");
});
