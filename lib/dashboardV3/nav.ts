/**
 * The v3 dashboard's main menu, built from who the person is (docs/redesign/SPEC.md
 * "Information architecture"): beginners see only what their goal needs, intermediate adds
 * Emails and Domains, pro adds Developers. Pure — icons are named here and drawn by the shell.
 */
export type Experience = "beginner" | "intermediate" | "pro";
export type BuildGoal = "store" | "business-site" | "blog" | "course" | "link-in-bio" | "landing" | "app" | "explore";

export type NavIcon = "home" | "sites" | "orders" | "learners" | "sol" | "emails" | "domains" | "developers" | "settings";

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
};

export const EXPERIENCES: readonly Experience[] = ["beginner", "intermediate", "pro"] as const;

export function parseExperience(value: unknown): Experience | null {
  return typeof value === "string" && (EXPERIENCES as readonly string[]).includes(value) ? (value as Experience) : null;
}

export function buildV3Nav(input: NavInput): V3NavItem[] {
  const experience = input.experience ?? "beginner";
  const sells = input.goal === "store" || !!input.sells;
  const teaches = input.goal === "course" || !!input.teaches;
  const beginner = experience === "beginner";
  const sitesLabel = beginner ? ((input.siteCount ?? 0) > 1 ? "My sites" : "My site") : "Sites & apps";

  const items: V3NavItem[] = [
    { id: "home", label: "Home", href: "/dashboard", icon: "home", primary: true },
    { id: "sites", label: sitesLabel, href: "/dashboard/sites", icon: "sites", primary: true },
  ];
  if (sells) items.push({ id: "orders", label: "Orders", href: "/dashboard/commerce", icon: "orders", primary: true });
  if (teaches) items.push({ id: "learners", label: "Learners", href: "/dashboard/learners", icon: "learners", primary: !sells });
  items.push({ id: "sol", label: "Ask SOL", href: "/dashboard/sol", icon: "sol", primary: true });
  if (!beginner) {
    items.push({ id: "emails", label: "Emails", href: "/dashboard/emails", icon: "emails", primary: false });
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
    const match = item.href === "/dashboard" ? pathname === "/dashboard" : pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (match && (!best || item.href.length > best.href.length)) best = item;
  }
  return best?.id ?? null;
}
