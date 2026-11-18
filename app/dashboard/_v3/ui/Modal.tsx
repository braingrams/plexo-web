"use client";

import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { Portal, focusableIn, trapTab } from "./portal";

export type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  /** Buttons along the bottom (main action last). On phones they stack full-width. */
  footer?: React.ReactNode;
  /** Max width on desktop (px). On phones it's always a bottom sheet. */
  width?: number;
  /** Clicking the backdrop closes it (default true). Turn off for unsaved forms. */
  closeOnBackdrop?: boolean;
  /** Which element gets focus first (default: the first field/button inside). */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  hideClose?: boolean;
};

/** A dialog: dimmed backdrop, focus kept inside, Esc closes, focus returns where it was. A bottom sheet on phones. */
export function Modal({ open, onClose, title, description, children, footer, width = 560, closeOnBackdrop = true, initialFocusRef, hideClose }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    const raf = requestAnimationFrame(() => {
      const root = ref.current;
      if (!root) return;
      const target = initialFocusRef?.current ?? focusableIn(root).find((el) => !el.dataset.modalClose) ?? root;
      target.focus();
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [open, initialFocusRef]);

  if (!open) return null;
  return (
    <Portal>
      <div
        className="plx-overlay"
        onMouseDown={(e) => {
          if (closeOnBackdrop && e.target === e.currentTarget) onClose();
        }}
      >
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description ? descId : undefined}
          tabIndex={-1}
          className="plx-dialog"
          style={{ ["--plx-dialog-w" as string]: `${width}px` }}
          onKeyDown={(e) => trapTab(e, ref.current)}
        >
          <span className="plx-dialog__grab" aria-hidden />
          <div className="plx-dialog__head">
            <div>
              <h2 id={titleId} className="plx-dialog__title">
                {title}
              </h2>
              {description ? (
                <p id={descId} className="plx-dialog__desc">
                  {description}
                </p>
              ) : null}
            </div>
            {hideClose ? null : (
              <button type="button" className="plx-iconbtn" onClick={onClose} aria-label="Close" data-modal-close="true">
                <X size={20} aria-hidden />
              </button>
            )}
          </div>
          {children ? <div className="plx-dialog__body">{children}</div> : <div style={{ height: 20 }} />}
          {footer ? <div className="plx-dialog__foot">{footer}</div> : null}
        </div>
      </div>
    </Portal>
  );
}
