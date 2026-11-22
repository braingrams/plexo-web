"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { CircleCheck, CircleAlert, Info, X } from "lucide-react";
import { Portal } from "./portal";

export type ToastTone = "success" | "danger" | "info";
export type ToastInput = { title: string; description?: string; tone?: ToastTone; action?: { label: string; onClick: () => void }; durationMs?: number };
type ToastItem = ToastInput & { id: number };

const ToastContext = createContext<{ show: (t: ToastInput) => void; dismiss: (id: number) => void } | null>(null);

/** Mounted once by the v3 root. Toasts are announced politely to screen readers. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => setItems((all) => all.filter((t) => t.id !== id)), []);
  const show = useCallback(
    (t: ToastInput) => {
      const id = next.current++;
      setItems((all) => [...all.slice(-2), { ...t, id }]);
      const ms = t.durationMs ?? (t.action ? 8000 : 5000);
      if (ms > 0) window.setTimeout(() => dismiss(id), ms);
    },
    [dismiss],
  );
  const value = useMemo(() => ({ show, dismiss }), [show, dismiss]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <Portal>
        <div className="plx-toasts" role="status" aria-live="polite">
          {items.map((t) => {
            const tone = t.tone ?? "success";
            const Icon = tone === "danger" ? CircleAlert : tone === "info" ? Info : CircleCheck;
            return (
              <div key={t.id} className={`plx-toast plx-toast--${tone}`}>
                <Icon size={20} className="plx-toast__icon" aria-hidden />
                <div className="plx-toast__text">
                  <span className="plx-toast__title">{t.title}</span>
                  {t.description ? <span className="plx-toast__desc">{t.description}</span> : null}
                </div>
                {t.action ? (
                  <button
                    type="button"
                    className="plx-toast__action"
                    onClick={() => {
                      t.action!.onClick();
                      dismiss(t.id);
                    }}
                  >
                    {t.action.label}
                  </button>
                ) : null}
                <button type="button" className="plx-toast__close" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
                  <X size={16} aria-hidden />
                </button>
              </div>
            );
          })}
        </div>
      </Portal>
    </ToastContext.Provider>
  );
}

const noopToast = {
  show: (_t: ToastInput) => {},
  dismiss: (_id: number) => {},
};

export function useToast() {
  const ctx = useContext(ToastContext);
  return ctx ?? noopToast;
}
