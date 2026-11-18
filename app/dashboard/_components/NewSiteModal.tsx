"use client";

import type { PlanId } from "@/lib/plan/plans";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { NewSiteWizard } from "../new/NewSiteWizard";
import { NewSiteFlow, type NewSiteContext } from "../_v3/newsite/NewSiteFlow";
import "../_v3/legacy.css";

type Plan = PlanId;
type NewSiteContextValue = { openNewSite: () => void };

const NewSiteContext = createContext<NewSiteContextValue | null>(null);

/**
 * The one place to start creating a site. Any "Add new", "Create", or "Start building" button
 * calls useNewSite().openNewSite(), which opens the same wizard in a modal on the current page.
 * Nothing navigates away, so the user keeps their place.
 */
export function NewSiteProvider({ plan, v3, children }: { plan: Plan; /** New dashboard: the new "Make a new website" flow replaces the old wizard. */ v3?: NewSiteContext; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const openNewSite = useCallback(() => setOpen(true), []);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  const value = useMemo(() => ({ openNewSite }), [openNewSite]);

  return (
    <NewSiteContext.Provider value={value}>
      {children}
      {open && v3 ? <NewSiteFlow mode="dialog" context={v3} onClose={close} /> : null}
      {open && !v3 && (
        <div
          role="dialog"
          className="plx-legacy"
          aria-modal="true"
          aria-label="Create a new site"
          onClick={close}
          style={{
            position: "fixed", inset: 0, zIndex: 1000,
            background: "color-mix(in srgb, var(--bg) 85%, transparent)",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
            display: "flex", alignItems: "flex-start", justifyContent: "center",
            overflowY: "auto", padding: "48px 24px",
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              width: "100%", maxWidth: 1080,
              background: "var(--surface)",
              border: "1px solid var(--surface-border)",
              borderRadius: 18,
              padding: "28px 32px",
              boxShadow: "var(--shadow-card)",
            }}
          >
            <NewSiteWizard onClose={close} plan={plan} />
          </div>
        </div>
      )}
    </NewSiteContext.Provider>
  );
}

export function useNewSite(): NewSiteContextValue {
  const ctx = useContext(NewSiteContext);
  if (!ctx) throw new Error("useNewSite must be used inside NewSiteProvider (mounted by the dashboard shell).");
  return ctx;
}

/** Same as useNewSite, but null outside NewSiteProvider (used by the v3 shell's site switcher). */
export function useOptionalNewSite(): NewSiteContextValue | null {
  return useContext(NewSiteContext);
}
