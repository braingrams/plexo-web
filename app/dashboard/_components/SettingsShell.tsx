"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PageContainer } from "./PageContainer";

type SubNavItem = { href: string; label: string };
type SubNavGroup = { key: string; label: string; items: SubNavItem[] };

const GROUPS: SubNavGroup[] = [
  {
    key: "account",
    label: "Account",
    items: [
      { href: "/dashboard/profile", label: "Profile" },
      { href: "/dashboard/settings/notifications", label: "Notifications" },
      { href: "/dashboard/settings/subscription", label: "Subscription" },
      { href: "/dashboard/transfers", label: "Transfers" },
      { href: "/dashboard/settings/team", label: "Team" },
      { href: "/dashboard/settings/branding", label: "Branding" },
    ],
  },
  {
    key: "developer",
    label: "Developer",
    items: [
      { href: "/dashboard/settings/api-keys", label: "API Keys" },
      { href: "/dashboard/settings/ai", label: "AI" },
      { href: "/dashboard/integrations", label: "Integrations" },
      { href: "/dashboard/settings/email-log", label: "Email Log" },
    ],
  },
  {
    key: "analytics",
    label: "Analytics",
    items: [{ href: "/dashboard/insights", label: "Insights" }],
  },
];

/** Settings' two-level nav — mirrors Commerce's own module hierarchy exactly: a horizontal,
 * underline-tab row for the SECTION (Account/Developer/Analytics — same style as
 * CommerceTabs), and a lighter horizontal PILL row underneath for whichever section's own
 * pages (same dash-pill-nav classes as Commerce's SettingsPillNav) — never both rendered as
 * equal-weight pill rows stacked on top of each other, and never a label repeated on top of
 * a pill row that's already legible on its own. Only the active section's items show at
 * all; switching sections is itself a real navigation (to that section's first page), not a
 * client-only toggle, so every page stays deep-linkable. */
function SettingsNav() {
  const pathname = usePathname();
  const activeGroup = GROUPS.find((g) => g.items.some((item) => pathname.startsWith(item.href))) ?? GROUPS[0];

  return (
    <div style={{ marginBottom: "1.75rem" }}>
      <nav
        aria-label="Settings section"
        style={{
          display: "flex",
          gap: "0.3rem",
          overflowX: "auto",
          borderBottom: "1px solid rgba(255,255,255,0.07)",
          paddingBottom: 1,
          marginBottom: "1.1rem",
        }}
      >
        {GROUPS.map((group) => {
          const isActive = group.key === activeGroup.key;
          return (
            <Link
              key={group.key}
              href={group.items[0].href}
              style={{
                padding: "0.55rem 0.85rem",
                fontSize: "0.83rem",
                fontWeight: isActive ? 600 : 500,
                color: isActive ? "#fff" : "rgba(240,242,255,0.5)",
                borderBottom: `2px solid ${isActive ? "var(--brand, var(--brand))" : "transparent"}`,
                whiteSpace: "nowrap",
                flexShrink: 0,
                textDecoration: "none",
              }}
            >
              {group.label}
            </Link>
          );
        })}
      </nav>

      {activeGroup.items.length > 1 && (
        <nav aria-label={`${activeGroup.label} settings navigation`} className="dash-pill-nav" style={{ flex: "0 0 auto", overflowX: "auto" }}>
          {activeGroup.items.map((item) => {
            const isActive = pathname.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href} className={`dash-pill-nav-item${isActive ? " active" : ""}`}>
                {item.label}
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
}

/** Shared chrome for every settings-adjacent page — Profile, Settings, Team, Branding,
 * Integrations, SDK Client, Insights. Applied as a wrapper component rather than a Next.js
 * layout.tsx since these pages don't share a URL prefix. */
export function SettingsShell({ children }: { children: React.ReactNode }) {
  return (
    <PageContainer>
      <SettingsNav />
      <div style={{ minWidth: 0 }}>{children}</div>
    </PageContainer>
  );
}
