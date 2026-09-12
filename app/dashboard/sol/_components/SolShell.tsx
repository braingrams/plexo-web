"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import { ThreadSidebar } from "./ThreadSidebar";
import { SolEntranceOverlay, wasSolTransitionHandledRecently } from "./SolEntranceOverlay";
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
export function SolShell({ children, organizationName }: { children: React.ReactNode; organizationName: string }) {
  return (
    <SolSidebarProvider>
      <SolShellInner organizationName={organizationName}>{children}</SolShellInner>
    </SolSidebarProvider>
  );
}

function SolShellInner({ children, organizationName }: { children: React.ReactNode; organizationName: string }) {
  const pathname = usePathname();
  // "settings"/"memory" are SOL's own reserved subroutes (app/dashboard/sol/settings,
  // app/dashboard/sol/memory), not a conversation id — excluded so ThreadSidebar never
  // tries to highlight a nonexistent conversation matching one of those literal strings.
  const match = pathname.match(/^\/dashboard\/sol\/(?!settings$|memory$)([^/]+)$/);
  const { refreshSignal, mobileSidebarOpen, closeMobileSidebar, activeConversationIdOverride, setActiveConversationIdOverride } = useSolSidebar();
  // `pathname` always wins when it names a conversation — it's Next's own router state,
  // authoritative the instant any REAL navigation happens (clicking a different thread,
  // a deep link, the back button). The override only ever fills the gap right after
  // SolChatView creates a brand-new conversation via a plain `history.replaceState` (see
  // its own comment for why that's not a real router.replace) — Next's router has no idea
  // that call happened, so `pathname`/`match` stay stuck on the old `/dashboard/sol` index
  // route until the next real navigation, and the override is what keeps the sidebar
  // pointed at the right thread in that window.
  const pathnameConversationId = match ? match[1] : null;
  const activeConversationId = pathnameConversationId ?? activeConversationIdOverride;
  useEffect(() => {
    // Once `pathname` names ANY conversation for real, it's already taking priority above
    // (see `activeConversationId`) regardless of which id the override still holds — this
    // just tidies the now-redundant override away rather than leaving stale state around.
    if (activeConversationIdOverride && pathnameConversationId !== null) {
      setActiveConversationIdOverride(null);
    }
  }, [pathnameConversationId, activeConversationIdOverride, setActiveConversationIdOverride]);
  // Lazy-initialized to true when SolModeSwitch already played its own copy of this overlay
  // (via a portal, from the dashboard page, before navigation even started — see that
  // file's comment). Without this check, this component would ALSO decide to mount a
  // SolEntranceOverlay on arrival — a real one, since it has no way to know a click already
  // happened — stacking a second, independently-timed glow/wordmark animation directly on
  // top of the first. Checked once, synchronously, at mount — never re-derived — since the
  // marker is only meaningful for the specific navigation that just happened.
  const [overlayDone, setOverlayDone] = useState(() => wasSolTransitionHandledRecently());
  // Guarantees the overlay is the ONLY thing ever painted on a true first entry — SSR and
  // the very first client render both have `hydrated === false`, so ThreadSidebar/{children}
  // (and whatever loading skeleton they show while their own data fetches) don't exist in
  // the DOM at all yet, not even hidden behind the overlay. They start mounting and
  // fetching a tick later, safely underneath the still-fully-opaque overlay, instead of
  // racing it — the previous behavior technically had the overlay on top the whole time
  // too, but left room for a real one-frame flash of the skeleton during hydration on a
  // fresh page load, which is what this closes off entirely. Once the overlay has already
  // played once (`overlayDone`), content always renders immediately — this gate only ever
  // matters for the true first arrival.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const showContent = hydrated || overlayDone;

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", background: "#060409" }}>
      {!overlayDone && <SolEntranceOverlay onDone={() => setOverlayDone(true)} />}

      {showContent && (
        <>
          <div className="sol-sidebar-desktop" style={{ height: "100%", flexShrink: 0 }}>
            <ThreadSidebar activeConversationId={activeConversationId} refreshSignal={refreshSignal} organizationName={organizationName} />
          </div>

          {mobileSidebarOpen && (
            <div style={{ position: "fixed", inset: 0, zIndex: 400, display: "flex" }}>
              <div style={{ height: "100%", position: "relative" }}>
                <ThreadSidebar activeConversationId={activeConversationId} refreshSignal={refreshSignal} organizationName={organizationName} />
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
        </>
      )}

      <style>{`
        @media (max-width: 860px) {
          .sol-sidebar-desktop { display: none !important; }
        }
      `}</style>
    </div>
  );
}
