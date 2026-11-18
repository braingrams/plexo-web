"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { cx } from "../ui/cx";

/**
 * A small pop-over menu (account, help, site switcher): opens from a button, closes on Esc,
 * outside click or picking an item, arrow keys move between items, focus returns to the button.
 */
export function useMenu() {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    requestAnimationFrame(() => wrap.current?.querySelector<HTMLElement>('[role="menu"] [role^="menuitem"]')?.focus());
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const onMenuKey = (e: React.KeyboardEvent) => {
    const items = Array.from(wrap.current?.querySelectorAll<HTMLElement>('[role="menu"] [role^="menuitem"]') ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      items[(i + 1) % items.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[(i - 1 + items.length) % items.length]?.focus();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  return {
    open,
    setOpen,
    close,
    wrapProps: { ref: wrap, className: "plx-menu-wrap" },
    buttonProps: { ref: button, "aria-haspopup": "menu" as const, "aria-expanded": open, "aria-controls": open ? menuId : undefined, onClick: () => setOpen((o) => !o) },
    menuProps: { id: menuId, role: "menu" as const, onKeyDown: onMenuKey },
  };
}

export function MenuPanel({ align = "right", className, children, ...rest }: { align?: "left" | "right"; className?: string; children: React.ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx("plx-menu", align === "left" && "plx-menu--left", className)} {...rest}>
      {children}
    </div>
  );
}
