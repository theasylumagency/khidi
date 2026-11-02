import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedPrincipal } from "@khidi/auth";
const { session } = vi.hoisted(() => ({ session: { principal: null as AuthenticatedPrincipal | null } }));
vi.mock("../../../lib/session.ts", () => ({ getCurrentPrincipal: async () => session.principal }));
import { POST as createTask } from "./tasks/route.ts";
import { POST as printLabels } from "./labels/route.ts";
import { POST as intake } from "./intakes/route.ts";
import { GET as currentSession } from "./session/route.ts";

describe("M3 scanning route authorization", () => {
  const request = () => new Request("http://localhost:3100/api/scanning/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  it("requires a verified session for all scanning writes", async () => {
    session.principal = null;
    for (const handler of [createTask, printLabels, intake]) expect((await handler(request())).status).toBe(401);
    expect((await currentSession()).status).toBe(401);
  });
  it("blocks warehouse users before they can create tasks or administer labels", async () => {
    session.principal = { role: "WAREHOUSE" } as AuthenticatedPrincipal;
    expect((await createTask(request())).status).toBe(403);
    expect((await printLabels(request())).status).toBe(403);
  });
});
