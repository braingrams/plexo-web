"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { NAV_ITEMS as BASE_NAV_ITEMS } from "./nav-items";
import { LayoutSwitchBanner } from "./_components/LayoutSwitchBanner";
import { OrgSwitcher, NotificationBell } from "./_components/TeamHeaderControls";
import { FeedbackButton } from "./_components/FeedbackButton";
import type { OrgBranding } from "./dashboard-shell";
import { darken, toRgba } from "@/lib/color";

/* ─── Icons ─────────────────────────────────── */
function IconTemplates() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

function IconSettings() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function IconProfile() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
    </svg>
  );
}

function IconLogout() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

function IconChevronLeft() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function IconChevronRight() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function IconMenu() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

function IconClose() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function IconSdk() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  );
}

function IconCompile() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}

function IconDomains() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function IconOverview() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </svg>
  );
}

function IconInsights() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18h18" />
      <path d="M7 14l4-4 3 3 5-6" />
    </svg>
  );
}

function IconMarketplace() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 8l1.5-4h13L20 8" />
      <path d="M4 8h16v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V8z" />
      <path d="M9 12a3 3 0 0 0 6 0" />
    </svg>
  );
}

function IconAiMcp() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" />
      <path d="M19 3v3M20.5 4.5H17.5" />
      <path d="M5 17v2.5M6.25 18.25H3.75" />
    </svg>
  );
}

const NAV_ICONS: Record<string, React.ReactNode> = {
  "/dashboard": <IconOverview />,
  "/dashboard/templates": <IconTemplates />,
  "/dashboard/insights": <IconInsights />,
  "/dashboard/marketplace": <IconMarketplace />,
  "/dashboard/compile": <IconCompile />,
  "/dashboard/sdk": <IconSdk />,
  "/dashboard/domains": <IconDomains />,
  "/dashboard/integrations": <IconAiMcp />,
  "/dashboard/settings": <IconSettings />,
  "/dashboard/profile": <IconProfile />,
};

const NAV_ITEMS = BASE_NAV_ITEMS.map((item) => ({ ...item, icon: NAV_ICONS[item.href] }));

type Props = {
  children: React.ReactNode;
  userName: string;
  userEmail: string;
  organizationName: string;
  orgBranding?: OrgBranding;
};

export function DashboardShellClassic({ children, userName, userEmail, organizationName, orgBranding }: Props) {
  const brandName = orgBranding?.name ?? "Plexo";
  const brandVars: React.CSSProperties = orgBranding?.color
    ? ({
      "--brand": orgBranding.color,
      "--brand-deep": darken(orgBranding.color, 0.12),
      "--brand-glow": toRgba(orgBranding.color, 0.35),
    } as React.CSSProperties)
    : {};
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  // Below 768px the sidebar becomes an off-canvas drawer (see .dash-classic-aside rules
  // in globals.css) triggered by the mobile top bar's hamburger button. Desktop's own
  // collapse/expand chevron state (`collapsed`) is unrelated and unaffected.
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  // The template editor needs its own full viewport below the desktop tier — there's no
  // room for the fixed sidebar chrome alongside the builder's own responsive layout.
  // Above that breakpoint (see .dash-classic-editor-route rules in globals.css), nothing changes.
  const isEditorRoute = pathname.startsWith("/dashboard/templates/") && pathname !== "/dashboard/templates";
  const rootClassName = isEditorRoute ? "dash-classic-root dash-classic-editor-route" : "dash-classic-root";

  const initials = userName
    .split(" ")
    .map((p) => p[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) || userEmail.slice(0, 2).toUpperCase();

  async function handleSignOut() {
    setIsSigningOut(true);
    try {
      await (authClient as any).signOut();
    } catch (e) {
      console.error("Sign out error:", e);
    }
    router.push("/auth/login");
  }

  const sidebarWidth = collapsed ? 64 : 250;
  // Extra breathing room between the fixed sidebar and the main content column —
  // without it, page content butts directly against the sidebar's right edge.
  const contentGutter = 24;

  // Close the mobile drawer whenever the route changes (navigating counts as "done").
  useEffect(() => {
    setIsMobileNavOpen(false);
  }, [pathname]);

  return (
    <div className={rootClassName} style={{ minHeight: "100vh", display: "flex", ...brandVars }}>
      {/* ── MOBILE TOP BAR (below 768px only) ─────── */}
      <header className="dash-classic-mobile-topbar flex md:hidden">
        <button
          type="button"
          onClick={() => setIsMobileNavOpen(true)}
          aria-label="Open navigation"
          style={{
            background: "none", border: "none", cursor: "pointer",
            color: "#f0f2ff", padding: "0.5rem",
            borderRadius: 8, display: "grid", placeItems: "center",
          }}
        >
          <IconMenu />
        </button>
        <span style={{
          fontFamily: "var(--font-heading), sans-serif",
          fontWeight: 700, fontSize: "0.95rem",
          color: "#f0f2ff", letterSpacing: "-0.02em",
        }}>
          {brandName}
        </span>
        <span style={{ width: 32 }} />
      </header>

      {/* ── MOBILE DRAWER BACKDROP ───────────────── */}
      {isMobileNavOpen && (
        <div
          className="dash-mobile-nav-backdrop"
          onClick={() => setIsMobileNavOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ── SIDEBAR ─────────────────────────────── */}
      <aside
        className={`dash-classic-aside${isMobileNavOpen ? " dash-classic-aside-open" : ""}`}
        style={{
          position: "fixed",
          top: 0, bottom: 0,
          // Pinned to the true viewport edge up to 1500px wide (max(0, ...) is 0 below that,
          // same as before). Past 1500px the whole shell (this + main content) should read as
          // a centered 1500px-wide app, not stretch the sidebar to the raw viewport edge.
          left: "max(0px, calc((100vw - 1500px) / 2))",
          zIndex: 40,
          width: sidebarWidth,
          display: "flex",
          flexDirection: "column",
          background: "rgba(10, 11, 16, 0.55)",
          borderRight: "1px solid rgba(255,255,255,0.04)",
          backdropFilter: "blur(30px)",
          WebkitBackdropFilter: "blur(20px)",
          transition: "width 0.25s cubic-bezier(0.4,0,0.2,1)",
          overflow: "hidden",
          // Keeps content clear of the notch/home-indicator in standalone/PWA mode
          // (see viewportFit:"cover" in app/layout.tsx) while the background above
          // still paints all the way to the true screen edge.
          paddingTop: "env(safe-area-inset-top)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
        aria-label="Dashboard navigation"
      >
        {/* Logo header */}
        <div style={{
          height: 60,
          display: "flex",
          alignItems: "center",
          justifyContent: collapsed ? "center" : "space-between",
          padding: collapsed ? "0" : "0 0.75rem 0 1rem",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          flexShrink: 0,
        }}>
          {!collapsed && (
            <Link href="/" style={{ display: "flex", alignItems: "center", gap: "0.55rem", textDecoration: "none" }}>
              {orgBranding?.logoUrl ? (
                <img
                  src={orgBranding.logoUrl}
                  alt={brandName}
                  width={30}
                  height={30}
                  style={{ borderRadius: 8, objectFit: "cover", flexShrink: 0 }}
                />
              ) : (
                <div style={{
                  width: 30, height: 30, borderRadius: 8,
                  background: "linear-gradient(135deg, var(--brand), var(--brand-deep))",
                  display: "grid", placeItems: "center",
                  boxShadow: "0 0 14px var(--brand-glow)",
                  flexShrink: 0,
                }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                    <path d="M12 2L4 7v5c0 4.97 3.35 9.63 8 10.93C17.65 21.63 21 16.97 21 12V7L12 2z" fill="white" opacity="0.95" />
                    <path d="M9 12l2 2 4-4" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              )}
              <span style={{
                fontFamily: "var(--font-heading), sans-serif",
                fontWeight: 700, fontSize: "1rem",
                color: "#f0f2ff", letterSpacing: "-0.02em",
                whiteSpace: "nowrap",
              }}>
                {brandName}
              </span>
            </Link>
          )}
          {collapsed && (
            orgBranding?.logoUrl ? (
              <img
                src={orgBranding.logoUrl}
                alt={brandName}
                width={30}
                height={30}
                style={{ borderRadius: 8, objectFit: "cover" }}
              />
            ) : (
              <div style={{
                width: 30, height: 30, borderRadius: 8,
                background: "linear-gradient(135deg, var(--brand), var(--brand-deep))",
                display: "grid", placeItems: "center",
                boxShadow: "0 0 14px var(--brand-glow)",
              }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                  <path d="M12 2L4 7v5c0 4.97 3.35 9.63 8 10.93C17.65 21.63 21 16.97 21 12V7L12 2z" fill="white" opacity="0.95" />
                  <path d="M9 12l2 2 4-4" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            )
          )}
          {!collapsed && (
            <button
              onClick={() => setCollapsed(true)}
              aria-label="Collapse sidebar"
              className="dash-classic-collapse-btn"
              style={{
                background: "none", border: "none", cursor: "pointer",
                color: "rgba(240,242,255,0.4)", padding: "0.35rem",
                borderRadius: 7, display: "grid", placeItems: "center",
                transition: "color 0.15s, background 0.15s",
              }}
            >
              <IconChevronLeft />
            </button>
          )}
          <button
            onClick={() => setIsMobileNavOpen(false)}
            aria-label="Close navigation"
            className="dash-classic-mobile-close-btn"
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: "rgba(240,242,255,0.6)", padding: "0.35rem",
              borderRadius: 7, display: "none", placeItems: "center",
            }}
          >
            <IconClose />
          </button>
        </div>

        {/* Expand button when collapsed */}
        {collapsed && (
          <div className="dash-classic-collapse-btn" style={{ display: "flex", justifyContent: "center", padding: "0.5rem 0 0.25rem" }}>
            <button
              onClick={() => setCollapsed(false)}
              aria-label="Expand sidebar"
              style={{
                background: "none", border: "none", cursor: "pointer",
                color: "rgba(240,242,255,0.4)", padding: "0.35rem",
                borderRadius: 7, display: "grid", placeItems: "center",
                transition: "color 0.15s",
              }}
            >
              <IconChevronRight />
            </button>
          </div>
        )}

        {/* Nav items */}
        <nav style={{ flex: 1, padding: "0.75rem 0.625rem", overflow: "hidden" }}>
          {!collapsed && (
            <p style={{
              fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.1em",
              textTransform: "uppercase", color: "rgba(240,242,255,0.25)",
              padding: "0.25rem 0.5rem 0.5rem", whiteSpace: "nowrap",
            }}>
              Navigation
            </p>
          )}
          <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: "0.2rem" }}>
            {NAV_ITEMS.map((item) => {
              const isActive = item.href === "/dashboard"
                ? pathname === "/dashboard"
                : pathname.startsWith(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    title={collapsed ? item.label : undefined}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.75rem",
                      padding: collapsed ? "0.6rem" : "0.6rem 0.75rem",
                      borderRadius: 10,
                      justifyContent: collapsed ? "center" : "flex-start",
                      fontSize: "0.875rem",
                      fontWeight: isActive ? 600 : 500,
                      color: isActive ? "#fff" : "rgba(240,242,255,0.55)",
                      textDecoration: "none",
                      background: isActive ? "linear-gradient(90deg, rgba(139,92,246,0.15), transparent)" : "transparent",
                      borderLeft: isActive && !collapsed ? "3px solid var(--brand)" : "3px solid transparent",
                      boxShadow: isActive ? "inset 0 1px 0 rgba(255,255,255,0.05)" : "none",
                      transition: "all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      position: "relative",
                    }}
                  >
                    <span style={{ flexShrink: 0 }}>{item.icon}</span>
                    {!collapsed && <span>{item.label}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* User chip at bottom */}
        <div style={{
          padding: "0.75rem 0.625rem",
          borderTop: "1px solid rgba(255,255,255,0.06)",
          flexShrink: 0,
        }}>
          <div style={{
            display: "flex", alignItems: "center",
            justifyContent: collapsed ? "center" : "space-between",
            gap: "0.4rem", marginBottom: "0.5rem",
          }}>
            {!collapsed && <OrgSwitcher organizationName={organizationName} anchor="left" />}
            <FeedbackButton />
            <NotificationBell anchor="left" />
          </div>
          {!collapsed && (
            <div style={{
              display: "flex", alignItems: "center", gap: "0.6rem",
              padding: "0.6rem 0.75rem",
              borderRadius: 10,
              background: "rgba(255,255,255,0.04)",
              marginBottom: "0.5rem",
              minWidth: 0,
            }}>
              <div style={{
                width: 30, height: 30, borderRadius: "50%",
                background: "linear-gradient(135deg, var(--brand), var(--brand-deep))",
                display: "grid", placeItems: "center",
                fontSize: "0.7rem", fontWeight: 700, color: "#fff",
                flexShrink: 0,
              }}>
                {initials}
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <p style={{ fontSize: "0.8rem", fontWeight: 600, color: "#f0f2ff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {userName}
                </p>
                <p style={{ fontSize: "0.7rem", color: "rgba(240,242,255,0.35)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {userEmail}
                </p>
              </div>
            </div>
          )}
          {collapsed && (
            <div style={{ display: "flex", justifyContent: "center", marginBottom: "0.5rem" }}>
              <div style={{
                width: 30, height: 30, borderRadius: "50%",
                background: "linear-gradient(135deg, var(--brand), var(--brand-deep))",
                display: "grid", placeItems: "center",
                fontSize: "0.7rem", fontWeight: 700, color: "#fff",
              }}>
                {initials}
              </div>
            </div>
          )}
          <button
            onClick={() => void handleSignOut()}
            disabled={isSigningOut}
            title="Sign out"
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: collapsed ? "center" : "flex-start",
              gap: "0.6rem",
              padding: collapsed ? "0.6rem" : "0.6rem 0.75rem",
              borderRadius: 10,
              background: isSigningOut ? "rgba(255,255,255,0.02)" : "none",
              border: "none",
              cursor: isSigningOut ? "not-allowed" : "pointer",
              color: isSigningOut ? "rgba(240,242,255,0.25)" : "rgba(240,242,255,0.4)",
              fontSize: "0.8rem", fontWeight: 500,
              transition: "background 0.15s, color 0.15s",
              whiteSpace: "nowrap",
            }}
          >
            {isSigningOut ? (
              <>
                <style dangerouslySetInnerHTML={{
                  __html: `
                  @keyframes logout-spin {
                    to { transform: rotate(360deg); }
                  }
                ` }} />
                <div style={{
                  width: 14, height: 14, borderRadius: "50%",
                  border: "2px solid rgba(255,255,255,0.1)",
                  borderTopColor: "rgba(240,242,255,0.5)",
                  animation: "logout-spin 0.6s linear infinite",
                  flexShrink: 0,
                }} />
              </>
            ) : (
              <IconLogout />
            )}
            {!collapsed && <span>{isSigningOut ? "Signing Out..." : "Sign Out"}</span>}
          </button>
        </div>
      </aside>

      {/* ── MAIN CONTENT ─────────────────────────── */}
      <div
        className="dash-classic-main"
        style={{
          flex: 1,
          marginLeft: `calc(${sidebarWidth + contentGutter}px + max(0px, calc((100vw - 1500px) / 2)))`,
          maxWidth: `calc(1500px - ${sidebarWidth + contentGutter}px)`,
          minHeight: "100vh",
          transition: "margin-left 0.25s cubic-bezier(0.4,0,0.2,1)",
          background: "var(--bg)",
        }}
      >
        <div className="dash-classic-banner" style={{ padding: "2rem 8px 0", maxWidth: 1500, margin: "0 auto" }}>
          <LayoutSwitchBanner />
        </div>
        {children}
      </div>
    </div>
  );
}
