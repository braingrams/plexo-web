"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/** The v3 root renders <div id="plx-portal"> inside its themed wrapper, so overlays keep the tokens. */
export const PORTAL_ID = "plx-portal";

export function Portal({ children }: { children: React.ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setTarget(document.getElementById(PORTAL_ID) ?? document.body);
  }, []);
  return target ? createPortal(children, target) : null;
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
}

/** Keeps Tab inside `root` (wraps at the ends). Returns true when it handled the key. */
export function trapTab(e: React.KeyboardEvent | KeyboardEvent, root: HTMLElement | null): boolean {
  if (e.key !== "Tab" || !root) return false;
  const items = focusableIn(root);
  if (!items.length) {
    e.preventDefault();
    root.focus();
    return true;
  }
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) {
    e.preventDefault();
    last.focus();
    return true;
  }
  if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
    return true;
  }
  return false;
}
