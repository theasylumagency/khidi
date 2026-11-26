import { beforeEach, expect, it, vi } from "vitest";
import { AppError, createUuidV7 as uuid } from "@khidi/shared";

const mocks=vi.hoisted(()=>({principal:vi.fn(),save:vi.fn()}));
vi.mock("../../../../lib/session.ts",()=>({getCurrentPrincipal:mocks.principal}));
vi.mock("@khidi/catalog-review",async importActual=>({
  ...await importActual<typeof import("@khidi/catalog-review")>(),saveRound:mocks.save
}));
import { POST } from "./route.ts";

beforeEach(()=>{
  vi.clearAllMocks();
  mocks.principal.mockResolvedValue({userId:uuid(),role:"ADMIN",authMethod:"OFFICE_PASSWORD_TOTP"});
});
function request() {
  return new Request("http://localhost:3100/api/catalog-review/round",{method:"POST",headers:{
    "Content-Type":"application/json",Origin:"http://localhost:3100",Host:"localhost:3100","Idempotency-Key":uuid()
  },body:JSON.stringify({action:"CLOSE",round:1,note:"უკუკავშირი მიღებულია"})});
}

it("returns the specific pending-photo reason without exposing other domain details",async()=>{
  mocks.save.mockRejectedValue(new AppError("CONFLICT","Photo rendering is still in progress.",{
    reason:"PHOTO_RENDER_PENDING",internal:"must stay private"
  }));
  const response=await POST(request());
  expect(response.status).toBe(409);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual({error:"CONFLICT",reason:"PHOTO_RENDER_PENDING"});
});

it.each([
  new AppError("CONFLICT","Other conflict.",{reason:"OTHER",internal:"must stay private"}),
  new AppError("FORBIDDEN","Assignment required.",{reason:"PHOTO_RENDER_PENDING"})
])("keeps other error details out of the response",async error=>{
  mocks.save.mockRejectedValue(error);
  const response=await POST(request());
  expect(await response.json()).toEqual({error:error.code});
});
