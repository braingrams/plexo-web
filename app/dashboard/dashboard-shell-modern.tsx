"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { NAV_ITEMS } from "./nav-items";
import { Avatar } from "./_components/Avatar";
import { LayoutSwitchBanner } from "./_components/LayoutSwitchBanner";
import { NotificationBell, OrgSwitcher } from "./_components/TeamHeaderControls";
import { FeedbackButton } from "./_components/FeedbackButton";
import type { OrgBranding } from "./dashboard-shell";
import { darken, toRgba } from "@/lib/color";

function IconChevronDown() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function IconLogout() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

function IconSettings() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function IconProfile() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
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

type Props = {
  children: React.ReactNode;
  userName: string;
  userEmail: string;
  organizationName: string;
  orgBranding?: OrgBranding;
};

export function DashboardShellModern({ children, userName, userEmail, organizationName, orgBranding }: Props) {
  const brandName = orgBranding?.name ?? "Plexo";
  // Overrides the globals.css --brand triplet for this subtree only (inline style on the
  // shell root cascades to every var(--brand)/var(--brand-deep)/var(--brand-glow) read
  // below it) — leaves the marketing site and other dashboards' sessions untouched.
  const brandVars: React.CSSProperties = orgBranding?.color
    ? ({
        "--brand": orgBranding.color,
        "--brand-deep": darken(orgBranding.color, 0.12),
        "--brand-glow": toRgba(orgBranding.color, 0.35),
      } as React.CSSProperties)
    : {};
  const pathname = usePathname();
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  // Below 768px the horizontally-scrolling pill nav is replaced by a hamburger-triggered
  // dropdown listing the same items (see .dash-pill-nav / .dash-mobile-nav-toggle rules
  // in globals.css). Above that breakpoint nothing changes.
  const [navMenuOpen, setNavMenuOpen] = useState(false);
  const navMenuRef = useRef<HTMLDivElement>(null);

  // The template editor needs its own full viewport below the desktop tier — there's no
  // room for the floating topbar/padding chrome alongside the builder's own responsive
  // layout. Above that breakpoint (see .dash-modern-editor-route rules in globals.css),
  // nothing changes.
  // Matches only the editor's own root (/dashboard/templates/<id>), not its "upload" sibling
  // or any /blog subroutes — those are normal PageContainer pages that still need the topbar.
  const editorRouteMatch = pathname.match(/^\/dashboard\/templates\/([^/]+)$/);
  const isEditorRoute = Boolean(editorRouteMatch && editorRouteMatch[1] !== "upload");
  const rootClassName = isEditorRoute ? "dash-modern-editor-route" : undefined;

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
      if (navMenuRef.current && !navMenuRef.current.contains(e.target as Node)) {
        setNavMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  // Close the mobile nav dropdown whenever the route changes.
  useEffect(() => {
    setNavMenuOpen(false);
  }, [pathname]);

  async function handleSignOut() {
    setIsSigningOut(true);
    try {
      await (authClient as any).signOut();
    } catch (e) {
      console.error("Sign out error:", e);
    }
    router.push("/auth/login");
  }

  return (
    <div className={rootClassName} style={{ minHeight: "100vh", ...brandVars }}>
      {/* ── FLOATING TOPBAR ─────────────────────────── */}
      <header className="dash-topbar">
        <Link href="/" className="dash-brand-link" style={{ display: "flex", alignItems: "center", gap: "0.5rem", textDecoration: "none", flexShrink: 1, minWidth: 0, overflow: "hidden" }}>
          {orgBranding?.logoUrl ? (
            <img
              src={orgBranding.logoUrl}
              alt={brandName}
              width={28}
              height={28}
              style={{ borderRadius: 8, objectFit: "cover", flexShrink: 0 }}
            />
          ) : (
            <div style={{
              width: 28, height: 28, borderRadius: 8,
              background: "linear-gradient(135deg, var(--brand), var(--brand-deep))",
              display: "grid", placeItems: "center",
              boxShadow: "0 0 14px var(--brand-glow)",
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M12 2L4 7v5c0 4.97 3.35 9.63 8 10.93C17.65 21.63 21 16.97 21 12V7L12 2z" fill="white" opacity="0.95" />
                <path d="M9 12l2 2 4-4" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          )}
          <span
            className="dash-brand-name"
            style={{
              fontFamily: "var(--font-heading), sans-serif",
              fontWeight: 700,
              fontSize: "0.95rem",
              color: "#f0f2ff",
              letterSpacing: "-0.02em",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              minWidth: 0,
            }}
          >
            {brandName}
          </span>
        </Link>

        <nav className="dash-pill-nav" style={{ overflowX: "auto" }} aria-label="Dashboard navigation">
          {NAV_ITEMS.map((item) => {
            const isActive = item.href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`dash-pill-nav-item${isActive ? " active" : ""}`}
                style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}
              >
                {item.label}
                {item.badge && (
                  <span style={{
                    fontSize: "9.5px", fontWeight: 700, letterSpacing: "0.04em",
                    color: "#c084fc", background: "rgba(196,132,252,0.16)",
                    padding: "2px 6px", borderRadius: 100,
                  }}>
                    {item.badge.toUpperCase()}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div ref={navMenuRef} className="dash-mobile-nav-toggle" style={{ position: "relative" }}>
          <button
            onClick={() => setNavMenuOpen((v) => !v)}
            aria-label="Dashboard navigation"
            aria-expanded={navMenuOpen}
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: "#f0f2ff", padding: "0.4rem", borderRadius: 8,
              display: "flex", alignItems: "center",
            }}
          >
            <IconMenu />
          </button>

          {navMenuOpen && (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 0.75rem)",
                left: 0,
                width: "min(220px, calc(100vw - 3rem))",
                background: "rgba(13,15,26,0.98)",
                border: "1px solid rgba(255,255,255,0.09)",
                borderRadius: 16,
                boxShadow: "0 24px 60px -12px rgba(0,0,0,0.6)",
                backdropFilter: "blur(20px)",
                WebkitBackdropFilter: "blur(20px)",
                padding: "0.5rem",
                zIndex: 50,
              }}
            >
              {NAV_ITEMS.map((item) => {
                const isActive = item.href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setNavMenuOpen(false)}
                    style={{
                      display: "flex", alignItems: "center", gap: "0.5rem",
                      padding: "0.6rem 0.65rem", borderRadius: 10,
                      fontSize: "0.85rem", fontWeight: isActive ? 600 : 500,
                      color: isActive ? "var(--brand)" : "rgba(240,242,255,0.7)",
                      background: isActive ? "var(--brand-subtle)" : "transparent",
                      textDecoration: "none",
                    }}
                  >
                    {item.label}
                    {item.badge && (
                      <span style={{
                        fontSize: "9.5px", fontWeight: 700, letterSpacing: "0.04em",
                        color: "#c084fc", background: "rgba(196,132,252,0.16)",
                        padding: "2px 6px", borderRadius: 100,
                      }}>
                        {item.badge.toUpperCase()}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0 }}>
          <OrgSwitcher organizationName={organizationName} />
          <FeedbackButton />
          <NotificationBell />
        </div>

        <div ref={menuRef} style={{ position: "relative", flexShrink: 0 }}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Account menu"
            aria-expanded={menuOpen}
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex", alignItems: "center" }}
          >
            <Avatar name={userName} email={userEmail} size={32} />
          </button>

          {menuOpen && (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 0.75rem)",
                right: 0,
                width: 240,
                background: "rgba(13,15,26,0.98)",
                border: "1px solid rgba(255,255,255,0.09)",
                borderRadius: 16,
                boxShadow: "0 24px 60px -12px rgba(0,0,0,0.6)",
                backdropFilter: "blur(20px)",
                WebkitBackdropFilter: "blur(20px)",
                padding: "0.5rem",
                zIndex: 50,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.6rem 0.6rem 0.75rem", borderBottom: "1px solid rgba(255,255,255,0.06)", marginBottom: "0.4rem" }}>
                <Avatar name={userName} email={userEmail} size={34} />
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: "0.82rem", fontWeight: 600, color: "#f0f2ff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{userName}</p>
                  <p style={{ fontSize: "0.7rem", color: "rgba(240,242,255,0.4)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{userEmail}</p>
                </div>
              </div>

              <Link
                href="/dashboard/profile"
                onClick={() => setMenuOpen(false)}
                style={{ display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.55rem 0.6rem", borderRadius: 10, fontSize: "0.82rem", fontWeight: 500, color: "rgba(240,242,255,0.7)", textDecoration: "none" }}
              >
                <IconProfile />
                Profile
              </Link>

              <Link
                href="/dashboard/settings"
                onClick={() => setMenuOpen(false)}
                style={{ display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.55rem 0.6rem", borderRadius: 10, fontSize: "0.82rem", fontWeight: 500, color: "rgba(240,242,255,0.7)", textDecoration: "none" }}
              >
                <IconSettings />
                Settings
              </Link>

              <Link
                href="/dashboard/settings/team"
                onClick={() => setMenuOpen(false)}
                style={{ display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.55rem 0.6rem", borderRadius: 10, fontSize: "0.82rem", fontWeight: 500, color: "rgba(240,242,255,0.7)", textDecoration: "none" }}
              >
                <IconProfile />
                Team
              </Link>

              <Link
                href="/dashboard/settings/branding"
                onClick={() => setMenuOpen(false)}
                style={{ display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.55rem 0.6rem", borderRadius: 10, fontSize: "0.82rem", fontWeight: 500, color: "rgba(240,242,255,0.7)", textDecoration: "none" }}
              >
                <IconSettings />
                Branding
              </Link>

              <div style={{ height: 1, background: "rgba(255,255,255,0.06)", margin: "0.3rem 0" }} />

              <button
                onClick={() => void handleSignOut()}
                disabled={isSigningOut}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: "0.6rem",
                  padding: "0.55rem 0.6rem", borderRadius: 10,
                  background: "none", border: "none", textAlign: "left",
                  fontSize: "0.82rem", fontWeight: 500,
                  color: isSigningOut ? "rgba(240,242,255,0.3)" : "#f87171",
                  cursor: isSigningOut ? "not-allowed" : "pointer",
                }}
              >
                <IconLogout />
                {isSigningOut ? "Signing out…" : "Sign out"}
              </button>
            </div>
          )}
        </div>
      </header>

      {/* ── MAIN CONTENT ─────────────────────────── */}
      <div className="dash-main-modern">
        <div className="dash-main-modern-inner" style={{ maxWidth: 1920, margin: "0 auto" }}>
          <div className="dash-modern-banner">
            <LayoutSwitchBanner />
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
