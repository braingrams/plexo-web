"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { NewSiteWizard } from "../new/NewSiteWizard";

type Plan = "FREE" | "PRO" | "ULTRA";
type NewSiteContextValue = { openNewSite: () => void };

const NewSiteContext = createContext<NewSiteContextValue | null>(null);

/**
 * The one place to start creating a site. Any "Add new", "Create", or "Start building" button
 * calls useNewSite().openNewSite(), which opens the same wizard in a modal on the current page.
 * Nothing navigates away, so the user keeps their place.
 */
export function NewSiteProvider({ plan, children }: { plan: Plan; children: React.ReactNode }) {
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
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Create a new site"
          onClick={close}
          style={{
            position: "fixed", inset: 0, zIndex: 1000, background: "rgba(5,6,12,0.72)",
            display: "flex", alignItems: "flex-start", justifyContent: "center",
            overflowY: "auto", padding: "48px 24px",
          }}
        >
          <div onClick={(event) => event.stopPropagation()} style={{ width: "100%", maxWidth: 1080 }}>
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
