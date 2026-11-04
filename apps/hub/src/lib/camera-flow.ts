import type { PhotoTarget } from "@khidi/media/contracts";
export interface CameraFlow {
  open: boolean; sheet: "manual" | "no-barcode" | null;
  photo: { target: Partial<PhotoTarget>; onlyMissing: boolean } | null;
}
export const INITIAL_CAMERA_FLOW: CameraFlow = { open: false, sheet: null, photo: null };
export type CameraFlowAction = { type: "open" | "close" | "stored" | "photos-complete" }
  | { type: "sheet"; sheet: CameraFlow["sheet"] } | { type: "photos"; photo: NonNullable<CameraFlow["photo"]> };
export function cameraFlow(state: CameraFlow, action: CameraFlowAction): CameraFlow {
  switch (action.type) {
    case "open": return { ...state, open: true };
    case "close": return { ...state, open: false, sheet: null }; // Keep unfinished photo work mounted.
    case "sheet": return { ...state, sheet: action.sheet };
    case "stored": return { ...state, sheet: null };
    case "photos": return { open: true, sheet: null, photo: action.photo };
    case "photos-complete": return { ...state, sheet: null, photo: null };
  }
}
