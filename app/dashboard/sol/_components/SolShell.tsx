"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import { ThreadSidebar } from "./ThreadSidebar";
import { SolEntranceOverlay } from "./SolEntranceOverlay";
import { SolSidebarProvider, useSolSidebar } from "./SolSidebarContext";

/**
 * Chrome shared by every route under /dashboard/sol — the conversation sidebar and the
 * one-shot entrance reveal. Deliberately a layout-level component (see
 * app/dashboard/sol/layout.tsx) rather than something SolChatView itself renders: Next.js
 * keeps a layout mounted across sibling route changes, so navigating between
 * /dashboard/sol/[a] and /dashboard/sol/[b] (clicking a different thread) never remounts
 * this — the sidebar doesn't flicker/refetch-from-scratch, and the entrance animation only
 * ever plays once per real "arrival" at the SOL surface, not on every thread switch.
 */
export function SolShell({ children }: { children: React.ReactNode }) {
  return (
    <SolSidebarProvider>
      <SolShellInner>{children}</SolShellInner>
    </SolSidebarProvider>
  );
}

function SolShellInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const match = pathname.match(/^\/dashboard\/sol\/([^/]+)$/);
  const activeConversationId = match ? match[1] : null;
  const { refreshSignal, mobileSidebarOpen, closeMobileSidebar } = useSolSidebar();
  const [overlayDone, setOverlayDone] = useState(false);

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", background: "#060409" }}>
      {!overlayDone && <SolEntranceOverlay onDone={() => setOverlayDone(true)} />}

      <div className="sol-sidebar-desktop" style={{ height: "100%", flexShrink: 0 }}>
        <ThreadSidebar activeConversationId={activeConversationId} refreshSignal={refreshSignal} />
      </div>

      {mobileSidebarOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 400, display: "flex" }}>
          <div style={{ height: "100%", position: "relative" }}>
            <ThreadSidebar activeConversationId={activeConversationId} refreshSignal={refreshSignal} />
            <button
              type="button"
              onClick={closeMobileSidebar}
              aria-label="Close conversations"
              style={{ position: "absolute", top: 12, right: -42, width: 30, height: 30, borderRadius: 8, background: "rgba(255,255,255,0.08)", border: "none", color: "#fff", display: "grid", placeItems: "center" }}
            >
              <X size={15} />
            </button>
          </div>
          <div style={{ flex: 1, background: "rgba(0,0,0,0.5)" }} onClick={closeMobileSidebar} />
        </div>
      )}

      <div style={{ flex: 1, minWidth: 0, height: "100%", display: "flex", flexDirection: "column" }}>{children}</div>

      <style>{`
        @media (max-width: 860px) {
          .sol-sidebar-desktop { display: none !important; }
        }
      `}</style>
    </div>
  );
}
