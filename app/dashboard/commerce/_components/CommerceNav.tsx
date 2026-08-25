"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type SubNavItem = { href: string; label: string; icon: React.ReactNode };

function IconOverview() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </svg>
  );
}

function IconProducts() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l2-5h14l2 5" />
      <path d="M3 9h18v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9z" />
      <path d="M9 13a3 3 0 0 0 6 0" />
    </svg>
  );
}

function IconOrders() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" />
      <path d="M14 2v6h6" />
      <path d="M8 13h8M8 17h5" />
    </svg>
  );
}

function IconAvailability() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M8 2v4M16 2v4M3 10h18" />
    </svg>
  );
}

function IconCustomers() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <path d="M16 4.2a3.2 3.2 0 0 1 0 6.2" />
      <path d="M19 14.3c1.8.7 3 2.5 3 4.7" />
    </svg>
  );
}

function IconDiscounts() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.6 12l-8.3 8.3a2 2 0 0 1-2.8 0l-6.8-6.8a2 2 0 0 1 0-2.8L11 2.4 20.6 12z" />
      <circle cx="8.5" cy="8.5" r="1.4" fill="currentColor" stroke="none" />
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

const SUB_NAV: SubNavItem[] = [
  { href: "/dashboard/commerce", label: "Overview", icon: <IconOverview /> },
  { href: "/dashboard/commerce/products", label: "Products", icon: <IconProducts /> },
  { href: "/dashboard/commerce/orders", label: "Orders", icon: <IconOrders /> },
  { href: "/dashboard/commerce/availability", label: "Availability", icon: <IconAvailability /> },
  { href: "/dashboard/commerce/customers", label: "Customers", icon: <IconCustomers /> },
  { href: "/dashboard/commerce/discounts", label: "Discounts", icon: <IconDiscounts /> },
  { href: "/dashboard/commerce/settings", label: "Settings", icon: <IconSettings /> },
];

/** The Commerce shell's own sub-navigation — nested inside the main Plexo sidebar, same
 * idea as Bumpa/Shopify's "you're inside a module now" secondary rail. Every /dashboard/commerce/*
 * route shares this via app/dashboard/commerce/layout.tsx. */
export function CommerceNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Commerce navigation" style={{ width: 190, flexShrink: 0 }}>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        {SUB_NAV.map((item) => {
          const isActive = item.href === "/dashboard/commerce" ? pathname === item.href : pathname.startsWith(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.65rem",
                  padding: "0.55rem 0.7rem",
                  borderRadius: 9,
                  fontSize: "0.84rem",
                  fontWeight: isActive ? 600 : 500,
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
