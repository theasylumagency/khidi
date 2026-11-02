import { describe, expect, it, vi } from "vitest";
import { loadPrincipalByUserId, type AuthenticatedPrincipal } from "@khidi/auth";
import { getDb } from "@khidi/db";
import { createScanTask, receiveIntake } from "@khidi/scanning";
import { createUuidV7 } from "@khidi/shared";
const { session } = vi.hoisted(() => ({ session: { principal: null as AuthenticatedPrincipal | null } }));
vi.mock("../../../lib/session.ts", () => ({ getCurrentPrincipal: async () => session.principal }));
import { POST as createTask } from "./tasks/route.ts";
import { POST as printLabels } from "./labels/route.ts";
import { POST as intake } from "./intakes/route.ts";
import { GET as currentSession } from "./session/route.ts";
import { GET as printableLabels } from "./labels/print/route.ts";
import { POST as resolveReview } from "./review/route.ts";
import { POST as discard } from "./discards/route.ts";
import { GET as taskProgress } from "./tasks/[taskId]/route.ts";

describe("M3 scanning route authorization", () => {
  const request = () => new Request("http://localhost:3100/api/scanning/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  it("requires a verified session for all scanning writes", async () => {
    session.principal = null;
    for (const handler of [createTask, printLabels, intake, resolveReview, discard]) expect((await handler(request())).status).toBe(401);
    expect((await currentSession()).status).toBe(401);
    expect((await printableLabels(request())).status).toBe(401);
    expect((await taskProgress(request(), { params: Promise.resolve({ taskId: createUuidV7() }) })).status).toBe(401);
  });
  it("serves private progress only for an assigned task", async () => {
    const db = getDb();
    const adminRow = await db.query.users.findFirst({ where: (user, { eq }) => eq(user.role, "ADMIN") });
    const warehouseRow = await db.query.users.findFirst({ where: (user, { eq }) => eq(user.role, "WAREHOUSE") });
    const admin = await loadPrincipalByUserId(db, adminRow!.id);
    const assigned = await createScanTask(db, admin, { idempotencyKey: createUuidV7(), taskType: "INTAKE_UNIQUE", title: "Progress", assigneeRole: "WAREHOUSE", targetCount: 27 });
    const other = await createScanTask(db, admin, { idempotencyKey: createUuidV7(), taskType: "INTAKE_UNIQUE", title: "Other", assigneeRole: "OPERATOR" });
    session.principal = await loadPrincipalByUserId(db, warehouseRow!.id);
    const response = await taskProgress(request(), { params: Promise.resolve({ taskId: assigned.body.id }) });
    expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(await response.json()).toMatchObject({ completedCount: 0, targetCount: 27 });
    expect((await taskProgress(request(), { params: Promise.resolve({ taskId: other.body.id }) })).status).toBe(404);
  });
  it("blocks warehouse users before they can create tasks or administer labels", async () => {
    session.principal = { role: "WAREHOUSE" } as AuthenticatedPrincipal;
    expect((await createTask(request())).status).toBe(403);
    expect((await printLabels(request())).status).toBe(403);
    expect((await printableLabels(request())).status).toBe(403);
    expect((await resolveReview(request())).status).toBe(403);
  });
  it("serves an authenticated standalone 58 × 40 mm print document without the admin page chrome", async () => {
    const db = getDb();
    const admin = await db.query.users.findFirst({ where: (user, { eq }) => eq(user.role, "ADMIN") });
    session.principal = await loadPrincipalByUserId(db, admin!.id);
    const intake = await receiveIntake(db, session.principal, { idempotencyKey: createUuidV7(), userId: admin!.id,
      deviceId: createUuidV7(), scannedAt: new Date().toISOString(), sourceMode: "QUICK_SCAN", isNoBarcode: true });
    const response = await printableLabels(new Request(`http://localhost:3100/api/scanning/labels/print?intakeIds=${intake.body.id}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    const html = await response.text();
    expect(html).toContain("size: 58mm 40mm"); expect(html).toContain("window.print()"); expect(html).not.toContain("<nav");
  });
});
