"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { useSolSidebar } from "../../sol/_components/SolSidebarContext";
import type { SiteContext } from "./logic";
import { ThreadList } from "./ThreadList";
import { useActiveConversationId } from "./SolChatsColumn";
import "./sol.css";

type SolV3Value = {
  /** The site the owner is working on (from onboarding), shown above the chat box. */
  site: SiteContext | null;
  setSite: (site: SiteContext | null) => void;
};

const Ctx = createContext<SolV3Value | null>(null);

/** Null in the classic SOL — that's how the chat knows which look to draw. */
export function useSolV3(): SolV3Value | null {
  return useContext(Ctx);
}

const SITE_KEY = "sol3:site";

/**
 * SOL's frame in the new look. The conversations live in the dashboard's left column (the shell
 * swaps the main menu for them while you are in SOL — see lib/dashboardV3/sidebarMode.ts), so this is
 * just the chat area. On phones, where that column is hidden, the list slides over the chat as a sheet.
 * (The shell provides SolSidebarProvider.)
 */
export function SolV3Shell({ children, leaveSolSurface }: { children: React.ReactNode; leaveSolSurface?: boolean }) {
  const pathname = usePathname() ?? "";
  const { refreshSignal, mobileSidebarOpen, closeMobileSidebar } = useSolSidebar();
  const activeId = useActiveConversationId();
  const [site, setSiteState] = useState<SiteContext | null>(null);
  // The phone sheet's list is only built once it has been opened (the desktop column already has one).
  const [sheetUsed, setSheetUsed] = useState(false);
  useEffect(() => {
    if (mobileSidebarOpen) setSheetUsed(true);
  }, [mobileSidebarOpen]);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(SITE_KEY);
      if (saved) setSiteState(JSON.parse(saved) as SiteContext);
    } catch {
      // Private mode: the chip simply starts empty.
    }
  }, []);

  // SOL is a normal place in the new dashboard, not a separate mode: someone who used to land
  // here by default is taken back to Home when they press Home.
  useEffect(() => {
    if (leaveSolSurface) fetch("/api/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ preferredSurface: "DASHBOARD" }) }).catch(() => {});
  }, [leaveSolSurface]);

  // Going to another page of SOL closes the phone sheet.
  useEffect(() => closeMobileSidebar(), [pathname, closeMobileSidebar]);

  const setSite = useCallback((next: SiteContext | null) => {
    setSiteState(next);
    try {
      if (next) sessionStorage.setItem(SITE_KEY, JSON.stringify(next));
      else sessionStorage.removeItem(SITE_KEY);
    } catch {
      // fine
    }
  }, []);

  const value = useMemo(() => ({ site, setSite }), [site, setSite]);

  return (
    <Ctx.Provider value={value}>
      <div className="sol3" data-sheet={mobileSidebarOpen ? "open" : "closed"}>
        <div className="sol3-sheet">{sheetUsed ? <ThreadList activeConversationId={activeId} refreshSignal={refreshSignal} /> : null}</div>
        <div className="sol3-scrim" onClick={closeMobileSidebar} aria-hidden />
        <div className="sol3-main">{children}</div>
      </div>
    </Ctx.Provider>
  );
}
