"use client";

import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, X } from "lucide-react";

const SlotContext = createContext<HTMLElement | null>(null);

/**
 * Every banner on a page (plan notice, "what's new", the moving-site notice, a card inviting you to customize…) lives in one
 * stack. Only the first is shown; the rest are folded behind "N more". Opening shows them all, and a close button folds them back.
 * `banners` are the layout's own; any page can add its banners with <InBannerStack>, so they join the same stack
 * instead of piling up. Banners that render nothing don't count.
 */
export function BannerStack({ banners, children }: { banners: ReactNode; children?: ReactNode }) {
  const list = useRef<HTMLDivElement>(null);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const id = useId();

  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const apply = () => {
      // The page's own banners are portalled into a slot inside the list: count its children as part of the list.
      const items = Array.from(el.children).flatMap((c) => (c instanceof HTMLElement && c.hasAttribute("data-banner-slot") ? Array.from(c.children) : [c])).filter((c): c is HTMLElement => c instanceof HTMLElement);
      items.forEach((item, i) => item.toggleAttribute("data-banner-folded", !open && i > 0));
      setCount(items.length);
    };
    apply();
    setReady(true);
    const mo = new MutationObserver(apply);
    mo.observe(el, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [open]);

  const extra = Math.max(0, (count ?? 0) - 1);
  // If the extras go away (dismissed or done), go back to the folded state on its own.
  useEffect(() => {
    if (extra === 0 && open) setOpen(false);
  }, [extra, open]);

  return (
    <SlotContext.Provider value={slot}>
      <div className="plx-banners" data-open={open ? "" : undefined} data-count={count ?? undefined} data-ready={ready ? "" : undefined}>
        <div ref={list} id={id} className="plx-banners__list">
          {banners}
          <div ref={setSlot} data-banner-slot="" style={{ display: "contents" }} />
        </div>
        {extra > 0 ? (
          <button type="button" className="plx-banners__more" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
            {open ? (
              <>
                <X size={14} aria-hidden /> Show less
              </>
            ) : (
              <>
                {extra} more {extra === 1 ? "notice" : "notices"} <ChevronDown size={14} aria-hidden />
              </>
            )}
          </button>
        ) : null}
      </div>
      {children}
    </SlotContext.Provider>
  );
}

/** A page's own banner: joins the layout's stack when there is one, and just shows in place when there isn't. */
export function InBannerStack({ children }: { children: ReactNode }) {
  const slot = useContext(SlotContext);
  return slot ? createPortal(children, slot) : <>{children}</>;
}
