"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type SubNavItem = { href: string; label: string; icon: React.ReactNode };

function IconOverview() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </svg>
  );
}

function IconProducts() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l2-5h14l2 5" />
      <path d="M3 9h18v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9z" />
      <path d="M9 13a3 3 0 0 0 6 0" />
    </svg>
  );
}

function IconOrders() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" />
      <path d="M14 2v6h6" />
      <path d="M8 13h8M8 17h5" />
    </svg>
  );
}

function IconDelivery() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="7" width="13" height="9" rx="1" />
      <path d="M14 10h4l4 3.5V16h-8z" />
      <circle cx="6" cy="18.5" r="1.7" />
      <circle cx="17.5" cy="18.5" r="1.7" />
    </svg>
  );
}

function IconAvailability() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M8 2v4M16 2v4M3 10h18" />
    </svg>
  );
}

function IconCustomers() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <path d="M16 4.2a3.2 3.2 0 0 1 0 6.2" />
      <path d="M19 14.3c1.8.7 3 2.5 3 4.7" />
    </svg>
  );
}

function IconDiscounts() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.6 12l-8.3 8.3a2 2 0 0 1-2.8 0l-6.8-6.8a2 2 0 0 1 0-2.8L11 2.4 20.6 12z" />
      <circle cx="8.5" cy="8.5" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconWallet() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v3" />
      <path d="M3 7v11a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-4" />
      <rect x="15" y="11" width="7" height="6" rx="1.2" />
      <circle cx="17.7" cy="14" r="0.9" fill="currentColor" stroke="none" />
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

/** The Commerce module's one and only section nav — horizontal, underline-tab style, at
 * every width (no more vertical-rail-at-md+ branch: "the menu are horizontal and
 * everything is placed cleanly" was the whole point of this redesign). Settings' own
 * General/Payments/Notifications sub-nav is a visually lighter horizontal PILL row (see
 * SettingsPillNav) — this distinction (underline for sections, pills for sub-sections)
 * is deliberate, not incidental. */
export function CommerceTabs({ templateId }: { templateId: string }) {
  const pathname = usePathname();
  const base = `/dashboard/commerce/${templateId}`;

  const subNav: SubNavItem[] = [
    { href: base, label: "Overview", icon: <IconOverview /> },
    { href: `${base}/products`, label: "Products", icon: <IconProducts /> },
    { href: `${base}/orders`, label: "Orders", icon: <IconOrders /> },
    { href: `${base}/delivery`, label: "Delivery", icon: <IconDelivery /> },
    { href: `${base}/availability`, label: "Availability", icon: <IconAvailability /> },
    { href: `${base}/customers`, label: "Customers", icon: <IconCustomers /> },
    { href: `${base}/discounts`, label: "Discounts", icon: <IconDiscounts /> },
    { href: `${base}/wallet`, label: "Wallet", icon: <IconWallet /> },
    { href: `${base}/settings`, label: "Settings", icon: <IconSettings /> },
  ];

  return (
    <nav
      aria-label="Commerce navigation"
      style={{
        display: "flex",
        gap: "0.3rem",
        overflowX: "auto",
        borderBottom: "1px solid rgba(255,255,255,0.07)",
        paddingBottom: 1,
        marginBottom: "1.5rem",
      }}
    >
      {subNav.map((item) => {
        const isActive = item.href === base ? pathname === item.href : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
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
            <span style={{ flexShrink: 0 }}>{item.icon}</span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
