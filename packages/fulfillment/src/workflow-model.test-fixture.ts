/** Independent unit oracle: it imports no production workflow or ledger arithmetic. */
export const modelOps=["reserve","extend","expire","commit","pick","return","handover","cancel","release","lost"] as const;
export type ModelOp=typeof modelOps[number];
export interface ModelCommand {op:ModelOp;slot:number;malformed:boolean}
interface Unit {slot:number;allocated:boolean;staged:boolean;held:boolean;committed:boolean}
export interface WorkflowModel {
  units:Unit[];counts:number[];picked:number[];returned:number[];lost:number[];handed:number[];released:number[];
  state:string;request:string;simple:boolean;cod:boolean;expired:boolean;returnPending:boolean;
}
export function initialWorkflowModel(simple:boolean,cod:boolean,bundle:boolean,quantity:number):WorkflowModel {
  return {units:[...Array.from({length:100},(_,i)=>({slot:0,allocated:i<60,staged:false,held:false,committed:false})),
    ...Array.from({length:20},()=>({slot:1,allocated:true,staged:false,held:false,committed:false}))],
    counts:bundle ? [quantity*2,quantity*3] : [quantity,0],picked:[0,0],returned:[0,0],lost:[0,0],handed:[0,0],released:[0,0],
    state:"NONE",request:"NONE",simple,cod,expired:false,returnPending:false};
}
function closeAutomatically(m:WorkflowModel) {
  m.picked=[...m.counts];m.handed=[...m.counts];m.units=m.units.filter((u)=>!u.held);m.state="HANDED_OVER";m.request="HANDED_OVER";
}
function cancel(m:WorkflowModel) {
  for(const u of m.units.filter((u)=>u.held && !u.staged)) {u.held=false;u.committed=false;m.released[u.slot]!++;}
  m.returnPending=m.units.some((u)=>u.held && u.staged);
  m.request=m.request==="NONE" ? "NONE" : "CANCELLED";
  if(!m.returnPending) m.state="RELEASED";
}
/** Returns whether the public command succeeds; rejected commands never mutate the oracle. */
export function modelCommand(m:WorkflowModel,c:ModelCommand):boolean {
  if(c.malformed) return false;
  const live=m.state==="RESERVED" || m.state==="COMMITTED";
  const staged=m.units.find((u)=>u.held && u.staged && u.slot===c.slot);
  switch(c.op) {
    case "reserve":
      if(m.state!=="NONE") return true; // Same durable request key: original response, no new units.
      for(let slot=0;slot<2;slot++) {
        const selected=m.units.filter((u)=>u.allocated && !u.held && u.slot===slot).slice(0,m.counts[slot]);
        if(selected.length!==m.counts[slot]) return false;
        for(const u of selected) u.held=true;
      }
      m.state="RESERVED";if(m.cod) {m.request="REQUESTED";if(m.simple)closeAutomatically(m);}return true;
    case "extend": return m.state==="RESERVED" && !m.expired;
    case "expire":
      if(m.state==="NONE") return false;
      if(!live) return true;
      m.expired=true;
      if(m.state==="COMMITTED") return true;
      if(m.units.some((u)=>u.held && u.staged)) m.request="ACTION_REQUIRED";
      else {for(const u of m.units.filter((u)=>u.held)){u.held=false;m.released[u.slot]!++;}m.state="EXPIRED";if(m.request!=="NONE")m.request="CANCELLED";}
      return true;
    case "commit":
      if(m.state!=="RESERVED" || m.expired || m.cod) return false;
      for(const u of m.units.filter((u)=>u.held))u.committed=true;
      m.state="COMMITTED";m.request="REQUESTED";if(m.simple)closeAutomatically(m);return true;
    case "pick": {
      if(!live || !["REQUESTED","PICKING"].includes(m.request) || m.picked[c.slot]!>=m.counts[c.slot]!)return false;
      const u=m.units.find((u)=>u.held && !u.staged && u.slot===c.slot);if(!u)return false;
      u.staged=true;m.picked[c.slot]!++;m.request=m.picked.every((n,i)=>n===m.counts[i]) ? "PICKED" : "PICKING";return true;
    }
    case "return":
      if(!live || !["CANCELLED","ACTION_REQUIRED"].includes(m.request) || !staged)return false;
      staged.staged=false;m.returned[c.slot]!++;
      if(m.returnPending) {
        staged.held=false;staged.committed=false;m.released[c.slot]!++;
        if(!m.units.some((u)=>u.held && u.staged)){m.returnPending=false;m.state="RELEASED";m.request="CANCELLED";}
      }
      return true;
    case "handover":
      if(!live || m.request!=="PICKED")return false;
      m.handed=[...m.counts];m.units=m.units.filter((u)=>!u.held);m.state="HANDED_OVER";m.request="HANDED_OVER";return true;
    case "cancel":
      if(!live || m.request==="NONE")return false;cancel(m);return true;
    case "release": if(m.state!=="RESERVED")return false;cancel(m);return true;
    case "lost":
      if(!live || m.request==="NONE" || !staged)return false;
      m.units=m.units.filter((u)=>u!==staged);m.lost[c.slot]!++;cancel(m);return true;
  }
}
export function modelBalances(m:WorkflowModel,slot:number) {
  const all=m.units.filter((u)=>u.slot===slot),allocated=all.filter((u)=>u.allocated);
  return {shelf:all.filter((u)=>!u.staged).length,staging:all.filter((u)=>u.staged).length,allocatedTotal:allocated.length,
    allocated:allocated.length,reserved:allocated.filter((u)=>u.held && !u.committed).length,committed:allocated.filter((u)=>u.held && u.committed).length,
    availableToSell:allocated.filter((u)=>!u.held).length};
}
