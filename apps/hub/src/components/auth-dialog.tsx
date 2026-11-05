"use client";
import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import "./auth-dialog.css";

export function AuthDialog({ title, description, onClose, returnFocus, obscureBackground, children }: {
  title: string; description: string; onClose?: () => void; returnFocus?: RefObject<HTMLElement | null>; obscureBackground?: boolean; children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null), heading = useRef<HTMLHeadingElement>(null);
  const titleId = useId(), descriptionId = useId();
  useEffect(() => {
    const element = dialog.current!, previous = document.activeElement;
    element.showModal(); heading.current?.focus({ preventScroll: true });
    return () => {
      element.close();
      const target = returnFocus?.current ?? previous;
      if (target instanceof HTMLElement && target.isConnected) target.focus({ preventScroll: true });
    };
  }, [returnFocus]);
  return <dialog className="auth-dialog" data-obscured={obscureBackground || undefined} ref={dialog} aria-labelledby={titleId} aria-describedby={descriptionId}
    onCancel={(event) => { event.preventDefault(); onClose?.(); }}>
    <h2 ref={heading} tabIndex={-1} id={titleId}>{title}</h2>
    <p id={descriptionId}>{description}</p>
    {children}
  </dialog>;
}
