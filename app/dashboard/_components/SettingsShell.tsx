"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PageContainer } from "./PageContainer";

type SubNavItem = { href: string; label: string };
type SubNavSection = { label: string; items: SubNavItem[] };

const SECTIONS: SubNavSection[] = [
  {
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
    label: "Developer",
    items: [
      { href: "/dashboard/settings/api-keys", label: "API Keys" },
      { href: "/dashboard/settings/ai", label: "AI" },
      { href: "/dashboard/integrations", label: "Integrations" },
      { href: "/dashboard/settings/email-log", label: "Email Log" },
    ],
  },
  {
    label: "Analytics",
    items: [{ href: "/dashboard/insights", label: "Insights" }],
  },
];

function SettingsNav() {
  const pathname = usePathname();
  return (
    <div style={{ marginBottom: "1.75rem", display: "flex", flexDirection: "column", gap: "0.85rem" }}>
      {SECTIONS.map((section) => (
        <div key={section.label}>
          <p
            style={{
              fontSize: "0.65rem",
              fontWeight: 700,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "rgba(240,242,255,0.28)",
              margin: "0 0 0.4rem 0.1rem",
            }}
          >
            {section.label}
          </p>
          <nav
            aria-label={`${section.label} settings navigation`}
            className="dash-pill-nav"
            style={{ flex: "0 0 auto", overflowX: "auto" }}
          >
            {section.items.map((item) => {
              const isActive = pathname.startsWith(item.href);
              return (
                <Link key={item.href} href={item.href} className={`dash-pill-nav-item${isActive ? " active" : ""}`}>
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      ))}
    </div>
  );
}

/** Shared chrome for every settings-adjacent page — Profile, Settings, Team, Branding,
 * Integrations, SDK Client, Insights. A horizontal pill sub-nav grouped into a few labeled
 * rows, never a second sidebar — mirrors the Commerce settings module's own SettingsPillNav
 * pattern (dash-pill-nav/dash-pill-nav-item, the same classes the main topbar nav uses)
 * instead of the vertical sidebar this used to be. Applied as a wrapper component rather than
 * a Next.js layout.tsx since these pages don't share a URL prefix. */
export function SettingsShell({ children }: { children: React.ReactNode }) {
  return (
    <PageContainer>
      <SettingsNav />
      <div style={{ minWidth: 0 }}>{children}</div>
    </PageContainer>
  );
}
