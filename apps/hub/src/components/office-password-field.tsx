"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { t } from "@khidi/i18n";

type Selection = { start: number; end: number; direction: "forward" | "backward" | "none" };

export function OfficePasswordField({ value, onChange }: { value: string; onChange(value: string): void }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const pointerSelection = useRef<Selection | null>(null);
  const restoreSelection = useRef<Selection | null>(null);
  const [visible, setVisible] = useState(false);

  useLayoutEffect(() => {
    const selection = restoreSelection.current;
    restoreSelection.current = null;
    if (selection && input.current === document.activeElement) {
      input.current?.setSelectionRange(selection.start, selection.end, selection.direction);
    }
  }, [visible]);

  function rememberPointerSelection() {
    const field = input.current;
    pointerSelection.current = field === document.activeElement && field
      ? { start: field.selectionStart ?? value.length, end: field.selectionEnd ?? value.length,
        direction: field.selectionDirection ?? "none" } : null;
  }

  function toggle() {
    restoreSelection.current = pointerSelection.current;
    pointerSelection.current = null;
    // Keep typing after a touch/pointer toggle; keyboard activation keeps button focus.
    if (restoreSelection.current) input.current?.focus({ preventScroll: true });
    setVisible((current) => !current);
  }

  return <div className="auth-field">
    <label htmlFor={id}>{t("auth.password")}</label>
    <div className="auth-password-row">
      <input ref={input} id={id} name="password" type={visible ? "text" : "password"}
        autoComplete="current-password" autoCapitalize="none" autoCorrect="off" spellCheck={false}
        enterKeyHint="next" required value={value} onChange={(event) => onChange(event.target.value)} />
      <button type="button" className="auth-secondary auth-password-toggle" aria-controls={id}
        aria-label={t(visible ? "auth.hide_password" : "auth.show_password")}
        onPointerDown={rememberPointerSelection} onPointerCancel={() => { pointerSelection.current = null; }}
        onKeyDown={() => { pointerSelection.current = null; }} onClick={toggle}>
        {t(visible ? "auth.hide" : "auth.show")}
      </button>
    </div>
  </div>;
}
