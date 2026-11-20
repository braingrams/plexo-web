"use client";

import { createContext, useCallback, useContext, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LinkPending } from "../../ui/LinkPending";
import { shopHref, type ShopNavGroup, type ShopNavItem } from "@/lib/dashboardV3/shopSections";

const LEAVE_MESSAGE = "You have changes that aren't saved yet. Leave without saving them?";

/** Lets whichever form is open tell the menu it has unsaved changes, so switching sections can ask first. */
const DirtyContext = createContext<{ set: (dirty: boolean) => void } | null>(null);

/** Called by every settings form: while it holds unsaved changes, leaving the page (or switching section) asks first. */
export function useReportDirty(dirty: boolean) {
  const ctx = useContext(DirtyContext);
  useEffect(() => {
    ctx?.set(dirty);
    return () => ctx?.set(false);
  }, [ctx, dirty]);
}

/** The Shop tab frame: ONE menu (left on wide screens, a single dropdown on phones) and the open section beside it. */
export function ShopLayout({ siteId, groups, current, children }: { siteId: string; groups: ShopNavGroup[]; current: string; children: React.ReactNode }) {
  const router = useRouter();
  const dirty = useRef(false);
  const ctx = useRef({ set: (d: boolean) => { dirty.current = d; } }).current;
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (!dirty.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  const mayLeave = useCallback(() => !dirty.current || window.confirm(LEAVE_MESSAGE), []);
  const hrefOf = (i: ShopNavItem) => shopHref(siteId, i.section, i.part);
  const all = groups.flatMap((g) => g.items);
  const here = all.find((i) => i.key === current);

  return (
    <DirtyContext.Provider value={ctx}>
      <div className="plx-shoplay" data-tour="shop-tools">
        <nav className="plx-shopnav" aria-label="Shop">
          {groups.map((g) => (
            <div key={g.label} className="plx-shopnav__group">
              <p className="plx-shopnav__label">{g.label}</p>
              {g.items.map((i) => (
                <Link key={i.key} href={hrefOf(i)} className="plx-shopnav__item" aria-current={i.key === current ? "page" : undefined} scroll={false} onClick={(e) => { if (i.key !== current && !mayLeave()) e.preventDefault(); }}>
                  {i.label}
                  <LinkPending />
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="plx-shopmenu">
          <label className="plx-shopmenu__label" htmlFor="plx-shopmenu">Shop</label>
          <select
            id="plx-shopmenu"
            className="plx-shopmenu__select"
            value={here?.key ?? ""}
            onChange={(e) => {
              const next = all.find((i) => i.key === e.target.value);
              if (!next) return;
              if (!mayLeave()) {
                e.target.value = current;
                return;
              }
              router.push(hrefOf(next), { scroll: false });
            }}
          >
            {groups.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.items.map((i) => <option key={i.key} value={i.key}>{i.label}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="plx-shopbody">{children}</div>
      </div>
    </DirtyContext.Provider>
  );
}
