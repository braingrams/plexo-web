"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PageContainer } from "./PageContainer";

type SubNavItem = { href: string; label: string };
type SubNavSection = { label?: string; items: SubNavItem[] };

function IconProfile() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
    </svg>
  );
}

function IconSettings() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function IconCompile() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}

function IconSdk() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  );
}

function IconAiMcp() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" />
      <path d="M19 3v3M20.5 4.5H17.5" />
      <path d="M5 17v2.5M6.25 18.25H3.75" />
    </svg>
  );
}

function IconInsights() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18h18" />
      <path d="M7 14l4-4 3 3 5-6" />
    </svg>
  );
}

const ICONS: Record<string, React.ReactNode> = {
  "/dashboard/profile": <IconProfile />,
  "/dashboard/settings": <IconSettings />,
  "/dashboard/compile": <IconCompile />,
  "/dashboard/sdk": <IconSdk />,
  "/dashboard/integrations": <IconAiMcp />,
  "/dashboard/insights": <IconInsights />,
};

const SECTIONS: SubNavSection[] = [
  {
    items: [
      { href: "/dashboard/profile", label: "Profile" },
      { href: "/dashboard/settings", label: "Settings" },
    ],
  },
  {
    label: "Developer",
    items: [
      { href: "/dashboard/compile", label: "Compile" },
      { href: "/dashboard/sdk", label: "SDK Client" },
      { href: "/dashboard/integrations", label: "AI & MCP Skills" },
    ],
  },
  {
    items: [{ href: "/dashboard/insights", label: "Insights" }],
  },
];

function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Settings navigation" style={{ width: 190, flexShrink: 0 }}>
      {SECTIONS.map((section, i) => (
        <div key={i} style={{ marginBottom: i < SECTIONS.length - 1 ? "1.1rem" : 0 }}>
          {section.label && (
            <p style={{
              fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.1em",
              textTransform: "uppercase", color: "rgba(240,242,255,0.28)",
              padding: "0 0.7rem 0.4rem",
            }}>
              {section.label}
            </p>
          )}
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 2 }}>
            {section.items.map((item) => {
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
                    <span style={{ flexShrink: 0 }}>{ICONS[item.href]}</span>
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** Shared shell for every settings-adjacent page — Profile, Settings, Compile, SDK Client,
 * AI & MCP Skills, Insights. These stay at their existing URLs (no route move, nothing else
 * in the app that links to them needs to change); each page just wraps its own content in
 * this instead of a bare PageContainer, so navigating between them keeps the same chrome.
 * Same structural idea as CommerceNav/CommerceLayout, applied as a wrapper component rather
 * than a Next.js layout.tsx since these pages don't share a URL prefix. */
export function SettingsShell({ children }: { children: React.ReactNode }) {
  return (
    <PageContainer>
      <div style={{ display: "flex", gap: "2rem", alignItems: "flex-start" }}>
        <SettingsNav />
        <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      </div>
    </PageContainer>
  );
}
