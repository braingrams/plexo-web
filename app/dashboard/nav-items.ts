export type NavItem = { href: string; label: string; badge?: string };

// Flat, top-level nav — no collapsible groups/dropdowns. Everything that used to live in a
// "Content"/"Grow"/"Developer"/"Account" group now lives inside that section's own shell
// (see SettingsShell for Profile/Settings/Compile/SDK Client/AI & MCP Skills/Insights,
// PagesShell for Pages/Templates, CommerceNav for the Commerce module) — the top-level list
// only names the sections themselves.
// Marketplace is deliberately not a top-level item — it's reachable from inside Pages'
// Templates view (the "Browse marketplace" entry point in the New Template flow, plus a
// direct link in the Templates toolbar), not as its own primary destination.
export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/pages", label: "Pages" },
  { href: "/dashboard/blog", label: "Blog" },
  { href: "/dashboard/commerce", label: "Commerce", badge: "New" },
  { href: "/dashboard/domains", label: "Domains" },
  { href: "/dashboard/settings", label: "Settings" },
];
