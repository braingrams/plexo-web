export type NavItem = { href: string; label: string };
export type NavGroup = { id: string; label: string; items: NavItem[] };

export const PINNED_NAV_ITEM: NavItem = { href: "/dashboard", label: "Overview" };

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "content",
    label: "Content",
    items: [
      { href: "/dashboard/templates", label: "Templates" },
      { href: "/dashboard/pages", label: "Pages" },
      { href: "/dashboard/blog", label: "Blog" },
      { href: "/dashboard/marketplace", label: "Marketplace" },
    ],
  },
  {
    id: "grow",
    label: "Grow",
    items: [
      { href: "/dashboard/insights", label: "Insights" },
      { href: "/dashboard/domains", label: "Domains" },
    ],
  },
  {
    id: "developer",
    label: "Developer",
    items: [
      { href: "/dashboard/compile", label: "Compile" },
      { href: "/dashboard/sdk", label: "SDK Client" },
      { href: "/dashboard/integrations", label: "AI & MCP Skills" },
    ],
  },
  {
    id: "account",
    label: "Account",
    items: [
      { href: "/dashboard/settings", label: "Settings" },
      { href: "/dashboard/profile", label: "Profile" },
    ],
  },
];

// Flat view for consumers that just need "every nav item" regardless of grouping.
export const NAV_ITEMS: NavItem[] = [PINNED_NAV_ITEM, ...NAV_GROUPS.flatMap((g) => g.items)];
