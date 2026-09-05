"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type SubNavItem = { href: string; label: string; icon: React.ReactNode };

function IconOverview() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" />
    </svg>
  );
}
function IconPages() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M8 13h8M8 17h5" />
    </svg>
  );
}
function IconEnrollments() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" /><path d="M16 4.2a3.2 3.2 0 0 1 0 6.2" /><path d="M19 14.3c1.8.7 3 2.5 3 4.7" />
    </svg>
  );
}
function IconSettings() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

/** The Funnel module's section nav — same horizontal underline-tab shape as CommerceTabs. */
export function FunnelTabs({ templateId }: { templateId: string }) {
  const pathname = usePathname();
  const base = `/dashboard/funnels/${templateId}`;

  const subNav: SubNavItem[] = [
    { href: base, label: "Overview", icon: <IconOverview /> },
    { href: `${base}/pages`, label: "Pages", icon: <IconPages /> },
    { href: `${base}/enrollments`, label: "Enrollments", icon: <IconEnrollments /> },
    { href: `${base}/settings`, label: "Settings", icon: <IconSettings /> },
  ];

  return (
    <nav
      aria-label="Funnel navigation"
      style={{ display: "flex", gap: "0.3rem", overflowX: "auto", borderBottom: "1px solid rgba(255,255,255,0.07)", paddingBottom: 1, marginBottom: "1.5rem" }}
    >
      {subNav.map((item) => {
        const isActive = item.href === base ? pathname === item.href : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            style={{
              display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.55rem 0.85rem",
              fontSize: "0.83rem", fontWeight: isActive ? 600 : 500,
              color: isActive ? "#fff" : "rgba(240,242,255,0.5)",
              borderBottom: `2px solid ${isActive ? "var(--brand, #8b5cf6)" : "transparent"}`,
              whiteSpace: "nowrap", flexShrink: 0, textDecoration: "none",
            }}
          >
            <span style={{ flexShrink: 0 }}>{item.icon}</span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
