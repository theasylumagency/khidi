import { afterEach,expect,it,vi } from "vitest";
import { logoutSession,leaveSession,SESSION_ENROLLMENT_EVENT } from "./session-client.ts";
import { monitorSession } from "./session-monitor.ts";
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
it("preserves a setup handoff when this tab's idle monitor also receives the logout broadcast",async()=>{
 vi.useFakeTimers();const events=new EventTarget(),paths:string[]=[],request=vi.fn(async()=>null),now=Date.now();
 const watch=monitorSession({sessionId:"current",serverNowMs:now,lastActivityAtMs:now,deadlineMs:now+1200000,absoluteDeadlineMs:now+43200000,activityIntervalMs:30000},
  {now:Date.now,request,visible:()=>true,warning:()=>{},unavailable:()=>{},renewed:()=>{},ended:()=>void leaveSession("current",true)});
 events.addEventListener(SESSION_ENROLLMENT_EVENT,()=>watch.stop());
 vi.stubGlobal("window",{dispatchEvent:events.dispatchEvent.bind(events),location:{replace:(path:string)=>paths.push(path)}});
 vi.stubGlobal("navigator",{});
 vi.stubGlobal("BroadcastChannel",class{postMessage(){void watch.refresh();}close(){}});
 vi.stubGlobal("fetch",vi.fn(async()=>new Response("{}")));
 const token="s".repeat(43);await logoutSession("current",token);await Promise.resolve();
 expect(request).not.toHaveBeenCalled();expect(paths).toEqual(["/login?setup=1#setup="+token]);watch.stop();
});
it("does not pause authentication monitoring if the logout request failed",async()=>{
 const dispatchEvent=vi.fn();vi.stubGlobal("window",{dispatchEvent});vi.stubGlobal("fetch",vi.fn(async()=>new Response("{}",{status:503})));
 await expect(logoutSession("current","s".repeat(43))).rejects.toThrow("Logout unavailable");expect(dispatchEvent).not.toHaveBeenCalled();
});
