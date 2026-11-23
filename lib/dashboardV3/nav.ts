/**
 * The v3 dashboard's main menu, built from who the person is (docs/redesign/SPEC.md
 * "Information architecture"): beginners see only what their goal needs (plus Emails), intermediate adds
 * Domains, pro adds Developers. Pure — icons are named here and drawn by the shell.
 */
export type Experience = "beginner" | "intermediate" | "pro";
export type BuildGoal = "store" | "business-site" | "blog" | "course" | "link-in-bio" | "landing" | "app" | "explore";

export type NavIcon = "home" | "sites" | "orders" | "products" | "learners" | "sol" | "emails" | "domains" | "developers" | "settings";

export type V3NavItem = {
  id: NavIcon;
  label: string;
  href: string;
  icon: NavIcon;
  /** Shown in the phone tab bar (at most five fit); the rest live in the "More" sheet. */
  primary: boolean;
};

export type NavInput = {
  experience?: Experience | null;
  goal?: BuildGoal | null;
  /** True when any of their sites sells (store switched on) — shows Orders whatever the goal. */
  sells?: boolean;
  /** True when any of their sites has a course — shows Learners whatever the goal. */
  teaches?: boolean;
  siteCount?: number;
  /** A member invited to specific sites only: the menu shows just Home and their sites. */
  guest?: boolean;
};

/** Both open the shop that is switched on (/dashboard/commerce picks it), on the right tab. */
export const SHOP_ORDERS_HREF = "/dashboard/commerce";
export const SHOP_PRODUCTS_HREF = "/dashboard/commerce?to=products";

export const EXPERIENCES: readonly Experience[] = ["beginner", "intermediate", "pro"] as const;

export function parseExperience(value: unknown): Experience | null {
  return typeof value === "string" && (EXPERIENCES as readonly string[]).includes(value) ? (value as Experience) : null;
}

export function buildV3Nav(input: NavInput): V3NavItem[] {
  // Someone invited to specific sites: just Home and their sites. Everything else in the workspace is closed to them.
  if (input.guest) {
    return [
      { id: "home", label: "Home", href: "/dashboard", icon: "home", primary: true },
      { id: "sites", label: (input.siteCount ?? 0) > 1 ? "My sites" : "My site", href: "/dashboard/sites", icon: "sites", primary: true },
    ];
  }
  const experience = input.experience ?? "beginner";
  const sells = input.goal === "store" || !!input.sells;
  const teaches = input.goal === "course" || !!input.teaches;
  const beginner = experience === "beginner";
  const sitesLabel = beginner ? ((input.siteCount ?? 0) > 1 ? "My sites" : "My site") : "Sites & apps";

  const items: V3NavItem[] = [
    { id: "home", label: "Home", href: "/dashboard", icon: "home", primary: true },
    { id: "sites", label: sitesLabel, href: "/dashboard/sites", icon: "sites", primary: true },
  ];
  // A shop's two everyday jobs sit in the menu for beginners and pros alike: what people bought, and what you sell.
  if (sells) items.push({ id: "orders", label: "Orders", href: SHOP_ORDERS_HREF, icon: "orders", primary: true });
  if (sells) items.push({ id: "products", label: "Products", href: SHOP_PRODUCTS_HREF, icon: "products", primary: false });
  if (teaches) items.push({ id: "learners", label: "Learners", href: "/dashboard/learners", icon: "learners", primary: !sells });
  items.push({ id: "sol", label: "Ask SOL", href: "/dashboard/sol", icon: "sol", primary: true });
  // Emails is for everyone: a beginner who can't find it can't make an email. On a phone it sits in "More".
  items.push({ id: "emails", label: "Emails", href: "/dashboard/emails", icon: "emails", primary: false });
  if (!beginner) {
    items.push({ id: "domains", label: "Domains", href: "/dashboard/settings/domains", icon: "domains", primary: false });
  }
  if (experience === "pro") items.push({ id: "developers", label: "Developers", href: "/dashboard/settings/developers", icon: "developers", primary: false });
  items.push({ id: "settings", label: "Settings", href: "/dashboard/settings", icon: "settings", primary: true });
  return items;
}

/** The menu item a path belongs to (longest matching href wins; Home only on /dashboard itself). */
export function activeNavId(items: V3NavItem[], pathname: string): NavIcon | null {
  // Screens still under their old address (lesson writing, the email editor) belong to the same menu item.
  if (pathname === "/dashboard/funnels" || pathname.startsWith("/dashboard/funnels/")) pathname = "/dashboard/learners";
  else if (pathname === "/dashboard/templates") pathname = "/dashboard/emails";
  let best: V3NavItem | null = null;
  for (const item of items) {
    const path = item.href.split("?")[0];
    const match = path === "/dashboard" ? pathname === "/dashboard" : pathname === path || pathname.startsWith(`${path}/`);
    if (match && (!best || path.length > best.href.split("?")[0].length)) best = item;
  }
  return best?.id ?? null;
}
