"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

type SolSidebarContextValue = {
  /** Bumped whenever a conversation's title/ordering may have changed (a turn just
   * completed), so the persistent ThreadSidebar (see SolShell) knows to refetch. */
  refreshSignal: number;
  bumpRefresh: () => void;
  /** Off-canvas thread list on narrow viewports — state lives here (not in SolShell's own
   * local state) so SolHeader, several route-segments away as far as React's tree is
   * concerned (it's rendered inside {children}, SolShell's sibling-not-descendant of the
   * sidebar), can open it without prop-drilling through the server-rendered page files
   * that sit between app/dashboard/sol/layout.tsx and SolChatView. */
  mobileSidebarOpen: boolean;
  openMobileSidebar: () => void;
  closeMobileSidebar: () => void;
  /** Lets SolChatView tell the sidebar "this conversation is active now" WITHOUT going
   * through a real Next.js navigation — see its own setter's doc comment for why that
   * matters. `null` means "derive it from the URL as usual" (SolShellInner's own
   * usePathname-based match), which is the default/normal case for every OTHER way of
   * arriving at a conversation (clicking a thread in Recents, a deep link, etc.). */
  activeConversationIdOverride: string | null;
  setActiveConversationIdOverride: (id: string | null) => void;
};

const SolSidebarContext = createContext<SolSidebarContextValue | null>(null);

export function SolSidebarProvider({ children }: { children: React.ReactNode }) {
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [activeConversationIdOverride, setActiveConversationIdOverride] = useState<string | null>(null);
  const bumpRefresh = useCallback(() => setRefreshSignal((v) => v + 1), []);
  const openMobileSidebar = useCallback(() => setMobileSidebarOpen(true), []);
  const closeMobileSidebar = useCallback(() => setMobileSidebarOpen(false), []);
  const value = useMemo(
    () => ({
      refreshSignal,
      bumpRefresh,
      mobileSidebarOpen,
      openMobileSidebar,
      closeMobileSidebar,
      activeConversationIdOverride,
      setActiveConversationIdOverride,
    }),
    [refreshSignal, bumpRefresh, mobileSidebarOpen, openMobileSidebar, closeMobileSidebar, activeConversationIdOverride],
  );
  return <SolSidebarContext.Provider value={value}>{children}</SolSidebarContext.Provider>;
}

export function useSolSidebar(): SolSidebarContextValue {
  const ctx = useContext(SolSidebarContext);
  if (!ctx) throw new Error("useSolSidebar must be used within a SolSidebarProvider");
  return ctx;
}
