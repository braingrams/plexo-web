"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PageContainer } from "./PageContainer";

function IconPages() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 3H8a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7l-5-4z" />
      <path d="M14 3v4h5" />
      <line x1="10" y1="13" x2="16" y2="13" />
      <line x1="10" y1="17" x2="16" y2="17" />
    </svg>
  );
}

function IconTemplates() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

const SUB_NAV = [
  { href: "/dashboard/pages", label: "All Pages", icon: <IconPages /> },
  { href: "/dashboard/templates", label: "Templates", icon: <IconTemplates /> },
];

function PagesNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Pages navigation" style={{ width: 190, flexShrink: 0 }}>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        {SUB_NAV.map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                style={{
                  display: "flex", alignItems: "center", gap: "0.65rem",
                  padding: "0.55rem 0.7rem", borderRadius: 9,
                  fontSize: "0.84rem", fontWeight: isActive ? 600 : 500,
                  color: isActive ? "#fff" : "rgba(240,242,255,0.55)",
                  background: isActive ? "rgba(139,92,246,0.12)" : "transparent",
                  textDecoration: "none",
                  transition: "background 0.15s ease, color 0.15s ease",
                }}
              >
                <span style={{ flexShrink: 0 }}>{item.icon}</span>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Shared shell for Pages (multi-page sites overview) and Templates (every design in the
 * org's library) — "Pages" is the umbrella concept in the main nav; Templates lives inside
 * it as a sub-view, same wrapper-component pattern as SettingsShell. */
export function PagesShell({ children }: { children: React.ReactNode }) {
  return (
    <PageContainer>
      <div style={{ display: "flex", gap: "2rem", alignItems: "flex-start" }}>
        <PagesNav />
        <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      </div>
    </PageContainer>
  );
}
