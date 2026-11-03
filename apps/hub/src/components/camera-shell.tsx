"use client";
import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { t } from "@khidi/i18n";
import { createUuidV7 } from "@khidi/shared/uuid";
import { CameraShellLifecycle } from "../lib/camera-shell.ts";
import "./camera-shell.css";

const CameraShellContext = createContext<{ registerStop: (stop: () => void) => () => void } | null>(null);
export function useParentCameraShell() { return useContext(CameraShellContext); }
export function CameraShell({ open, title, onClose, onStop, children }: {
  open: boolean; title: string; onClose: () => void; onStop: () => void; children: ReactNode
}) {
  const dialog = useRef<HTMLDialogElement>(null), lifecycle = useRef<CameraShellLifecycle | null>(null);
  const callbacks = useRef({ onClose, onStop }); callbacks.current = { onClose, onStop };
  const stops = useRef(new Set<() => void>());
  const context = useRef({ registerStop: (stop: () => void) => { stops.current.add(stop); return () => { stops.current.delete(stop); }; } });
  useEffect(() => {
    if (!open || !dialog.current) return;
    const element = dialog.current, previousFocus = document.activeElement as HTMLElement | null;
    let disposed = false;
    element.showModal();
    const controller = new CameraShellLifecycle({ document, window, history,
      lockScroll: () => {
        const style = document.body.style, old = { overflow: style.overflow, position: style.position, top: style.top, width: style.width }, y = window.scrollY;
        Object.assign(style, { overflow: "hidden", position: "fixed", top: `-${y}px`, width: "100%" });
        return () => { Object.assign(style, old); window.scrollTo(0, y); };
      }, requestWakeLock: navigator.wakeLock ? () => navigator.wakeLock.request("screen") : undefined
    }, createUuidV7(), () => { callbacks.current.onStop(); stops.current.forEach((stop) => stop()); }, () => { if (!disposed) callbacks.current.onClose(); });
    lifecycle.current = controller; controller.open();
    return () => {
      disposed = true; controller.close(); lifecycle.current = null; element.close();
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [open]);
  return <CameraShellContext.Provider value={context.current}>
    <dialog ref={dialog} className="camera-shell" aria-label={title} onCancel={(event) => { event.preventDefault(); lifecycle.current?.close(); }}>
      <header className="camera-shell-header"><button type="button" className="camera-close" aria-label={t("camera.close")} onClick={() => lifecycle.current?.close()}>←</button><span>{title}</span></header>
      {children}
    </dialog>
  </CameraShellContext.Provider>;
}
