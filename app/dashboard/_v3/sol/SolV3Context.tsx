"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { SolSidebarProvider, useSolSidebar } from "../../sol/_components/SolSidebarContext";
import type { SiteContext } from "./logic";
import { ThreadList } from "./ThreadList";
import "./sol.css";

type SolV3Value = {
  /** The conversations panel on desktop. */
  listOpen: boolean;
  toggleList: () => void;
  /** The site the owner is working on (from onboarding), shown above the chat box. */
  site: SiteContext | null;
  setSite: (site: SiteContext | null) => void;
};

const Ctx = createContext<SolV3Value | null>(null);

/** Null in the classic SOL — that's how the chat knows which look to draw. */
export function useSolV3(): SolV3Value | null {
  return useContext(Ctx);
}

const LIST_KEY = "sol3:list";
const SITE_KEY = "sol3:site";

/**
 * SOL's frame in the new look: a conversations panel beside the chat, both inside the content
 * area of the Plexo shell (sidebar + top bar stay). On phones the panel slides over the chat.
 */
export function SolV3Shell({ children, leaveSolSurface }: { children: React.ReactNode; leaveSolSurface?: boolean }) {
  return (
    <SolSidebarProvider>
      <Frame leaveSolSurface={leaveSolSurface}>{children}</Frame>
    </SolSidebarProvider>
  );
}

function Frame({ children, leaveSolSurface }: { children: React.ReactNode; leaveSolSurface?: boolean }) {
  const pathname = usePathname() ?? "";
  const { refreshSignal, mobileSidebarOpen, closeMobileSidebar, activeConversationIdOverride } = useSolSidebar();
  const [listOpen, setListOpen] = useState(true);
  const [site, setSiteState] = useState<SiteContext | null>(null);

  useEffect(() => {
    try {
      if (localStorage.getItem(LIST_KEY) === "closed") setListOpen(false);
      const saved = sessionStorage.getItem(SITE_KEY);
      if (saved) setSiteState(JSON.parse(saved) as SiteContext);
    } catch {
      // Private mode: the panel simply starts open and the chip starts empty.
    }
  }, []);

  // SOL is a normal place in the new dashboard, not a separate mode: someone who used to land
  // here by default is taken back to Home when they press Home.
  useEffect(() => {
    if (leaveSolSurface) fetch("/api/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ preferredSurface: "DASHBOARD" }) }).catch(() => {});
  }, [leaveSolSurface]);

  // Going to another page of SOL closes the phone panel.
  useEffect(() => closeMobileSidebar(), [pathname, closeMobileSidebar]);

  const toggleList = useCallback(() => {
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 860px)").matches) return;
    setListOpen((v) => {
      try {
        localStorage.setItem(LIST_KEY, v ? "closed" : "open");
      } catch {
        // fine
      }
      return !v;
    });
  }, []);
  const setSite = useCallback((next: SiteContext | null) => {
    setSiteState(next);
    try {
      if (next) sessionStorage.setItem(SITE_KEY, JSON.stringify(next));
      else sessionStorage.removeItem(SITE_KEY);
    } catch {
      // fine
    }
  }, []);

  const match = pathname.match(/^\/dashboard\/sol\/(?!settings$|memory$)([^/]+)$/);
  const activeId = match ? match[1] : activeConversationIdOverride;
  const value = useMemo(() => ({ listOpen, toggleList, site, setSite }), [listOpen, toggleList, site, setSite]);

  return (
    <Ctx.Provider value={value}>
      <div className="sol3" data-list={listOpen ? "open" : "closed"} data-sheet={mobileSidebarOpen ? "open" : "closed"}>
        <ThreadList activeConversationId={activeId} refreshSignal={refreshSignal} />
        <div className="sol3-scrim" onClick={closeMobileSidebar} aria-hidden />
        <div className="sol3-main">{children}</div>
      </div>
    </Ctx.Provider>
  );
}
