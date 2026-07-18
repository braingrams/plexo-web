"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

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

function IconSdk() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  );
}

const NAV_ITEMS = [
  { href: "/dashboard/templates", label: "Templates", icon: <IconTemplates /> },
  { href: "/dashboard/sdk", label: "SDK Client", icon: <IconSdk /> },
  { href: "/dashboard/settings", label: "Settings", icon: <IconSettings /> },
  { href: "/dashboard/profile", label: "Profile", icon: <IconProfile /> },
];

type Props = {
  children: React.ReactNode;
  userName: string;
  userEmail: string;
};

export function DashboardShell({ children, userName, userEmail }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);

  const initials = userName
    .split(" ")
    .map((p) => p[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) || userEmail.slice(0, 2).toUpperCase();

  async function handleSignOut() {
    await (authClient as any).signOut();
    router.push("/auth/login");
  }

  const sidebarWidth = collapsed ? 64 : 240;

  return (
    <div style={{ minHeight: "100vh", display: "flex" }}>
      {/* ── SIDEBAR ─────────────────────────────── */}
      <aside
        style={{
          position: "fixed",
          top: 0, left: 0, bottom: 0,
          zIndex: 40,
          width: sidebarWidth,
          display: "flex",
          flexDirection: "column",
          background: "rgba(13,15,26,0.98)",
          borderRight: "1px solid rgba(255,255,255,0.07)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          transition: "width 0.25s cubic-bezier(0.4,0,0.2,1)",
          overflow: "hidden",
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
              <div style={{
                width: 30, height: 30, borderRadius: 8,
                background: "linear-gradient(135deg,#fc0694,#d4057d)",
                display: "grid", placeItems: "center",
                boxShadow: "0 0 14px rgba(252,6,148,0.4)",
                flexShrink: 0,
              }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                  <path d="M12 2L4 7v5c0 4.97 3.35 9.63 8 10.93C17.65 21.63 21 16.97 21 12V7L12 2z" fill="white" opacity="0.95" />
                  <path d="M9 12l2 2 4-4" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <span style={{
                fontFamily: "var(--font-heading), sans-serif",
                fontWeight: 700, fontSize: "1rem",
                color: "#f0f2ff", letterSpacing: "-0.02em",
                whiteSpace: "nowrap",
              }}>
                Plexo
              </span>
            </Link>
          )}
          {collapsed && (
            <div style={{
              width: 30, height: 30, borderRadius: 8,
              background: "linear-gradient(135deg,#fc0694,#d4057d)",
              display: "grid", placeItems: "center",
              boxShadow: "0 0 14px rgba(252,6,148,0.4)",
            }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                <path d="M12 2L4 7v5c0 4.97 3.35 9.63 8 10.93C17.65 21.63 21 16.97 21 12V7L12 2z" fill="white" opacity="0.95" />
                <path d="M9 12l2 2 4-4" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          )}
          {!collapsed && (
            <button
              onClick={() => setCollapsed(true)}
              aria-label="Collapse sidebar"
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
        </div>

        {/* Expand button when collapsed */}
        {collapsed && (
          <div style={{ display: "flex", justifyContent: "center", padding: "0.5rem 0 0.25rem" }}>
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
              const isActive = pathname.startsWith(item.href);
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
                      color: isActive ? "#fc0694" : "rgba(240,242,255,0.55)",
                      textDecoration: "none",
                      background: isActive ? "rgba(252,6,148,0.1)" : "transparent",
                      borderLeft: isActive && !collapsed ? "2px solid #fc0694" : "2px solid transparent",
                      transition: "background 0.15s, color 0.15s",
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
                background: "linear-gradient(135deg,#fc0694,#d4057d)",
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
                background: "linear-gradient(135deg,#fc0694,#d4057d)",
                display: "grid", placeItems: "center",
                fontSize: "0.7rem", fontWeight: 700, color: "#fff",
              }}>
                {initials}
              </div>
            </div>
          )}
          <button
            onClick={() => void handleSignOut()}
            title="Sign out"
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: collapsed ? "center" : "flex-start",
              gap: "0.6rem",
              padding: collapsed ? "0.6rem" : "0.6rem 0.75rem",
              borderRadius: 10,
              background: "none", border: "none", cursor: "pointer",
              color: "rgba(240,242,255,0.4)",
              fontSize: "0.8rem", fontWeight: 500,
              transition: "background 0.15s, color 0.15s",
              whiteSpace: "nowrap",
            }}
          >
            <IconLogout />
            {!collapsed && <span>Sign Out</span>}
          </button>
        </div>
      </aside>

      {/* ── MAIN CONTENT ─────────────────────────── */}
      <div style={{
        flex: 1,
        marginLeft: sidebarWidth,
        minHeight: "100vh",
        transition: "margin-left 0.25s cubic-bezier(0.4,0,0.2,1)",
        background: "var(--bg)",
      }}>
        {children}
      </div>
    </div>
  );
}
