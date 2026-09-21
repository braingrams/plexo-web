"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/dashboard/integrations", label: "Connect AI Tools" },
  { href: "/dashboard/sdk", label: "SDK Client" },
];

/** Two routes (the AI/MCP integration hub, the SDK client guide) presented as one
 * consolidated "Integrations" section in the Settings nav, split into these two tabs —
 * they used to be two separate top-level settings pages that read as two different
 * answers to the same question ("how do I connect something to my API key"). */
export function IntegrationSubTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Integrations sub-navigation" className="dash-pill-nav" style={{ marginBottom: "1.25rem", flex: "0 0 auto" }}>
      {TABS.map((tab) => {
        const isActive = pathname.startsWith(tab.href);
        return (
          <Link key={tab.href} href={tab.href} className={`dash-pill-nav-item${isActive ? " active" : ""}`}>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
