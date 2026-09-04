"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Settings' own sub-nav — General / Payments / Notifications — as horizontal pills,
 * reusing the app's real .dash-pill-nav/.dash-pill-nav-item classes (globals.css) that the
 * main topbar nav already uses, rather than inventing new pill CSS. Deliberately a
 * visually LIGHTER weight than CommerceTabs' underline tabs above it, so the hierarchy
 * reads module → site → section (underline tabs) → sub-section (pills), never a third
 * sidebar. */
export function SettingsPillNav({ templateId }: { templateId: string }) {
  const pathname = usePathname();
  const base = `/dashboard/commerce/${templateId}/settings`;

  const items = [
    { href: `${base}/general`, label: "General" },
    { href: `${base}/payments`, label: "Payments" },
    { href: `${base}/notifications`, label: "Notifications" },
  ];

  return (
    <nav aria-label="Commerce settings navigation" className="dash-pill-nav" style={{ marginBottom: "1.4rem", overflowX: "auto" }}>
      {items.map((item) => {
        const isActive = pathname.startsWith(item.href);
        return (
          <Link key={item.href} href={item.href} className={`dash-pill-nav-item${isActive ? " active" : ""}`}>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
