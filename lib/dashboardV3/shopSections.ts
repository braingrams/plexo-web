/**
 * The Shop tab of a site's hub: the everyday shop tools (money, customers, discounts, delivery, booking times,
 * donations, settings) in one place, in plain words. Pure — the hub page asks it which section to show and where
 * each old shop address now lives, so no owner is ever sent back to the old shop pages.
 */
export type ShopSectionId = "money" | "customers" | "discounts" | "delivery" | "bookings" | "donations" | "settings";
export type ShopSettingsPart = "general" | "payments" | "checkout" | "notifications";

export type ShopSection = { id: ShopSectionId; label: string; help: string };

export const SHOP_SECTIONS: ShopSection[] = [
  { id: "money", label: "Your money", help: "What you've earned, and how to move it to your bank account." },
  { id: "customers", label: "Customers", help: "Everyone who has bought from you." },
  { id: "discounts", label: "Discounts", help: "Codes people type at checkout to get money off." },
  { id: "delivery", label: "Delivery", help: "How you get things to people, and what it costs." },
  { id: "bookings", label: "Booking times", help: "The days and hours people can book you." },
  { id: "donations", label: "Donations", help: "Gifts people give, one-off or every month." },
  { id: "settings", label: "Shop settings", help: "Payments, checkout, emails and how your shop looks." },
];

export const SETTINGS_PARTS: { id: ShopSettingsPart; label: string; help: string }[] = [
  { id: "general", label: "General", help: "Your shop's name, currency and how its buttons look." },
  { id: "payments", label: "Payments", help: "How customers pay you." },
  { id: "checkout", label: "Checkout", help: "What you ask for at checkout, and delivery or pickup." },
  { id: "notifications", label: "Emails", help: "Which emails go out when someone buys." },
];

/** One entry of the Shop tab's single side menu. Settings' four parts are entries here, not a second row. */
export type ShopNavItem = { key: string; label: string; help: string; section: ShopSectionId; part?: ShopSettingsPart };
export type ShopNavGroup = { label: string; items: ShopNavItem[] };

/** The one menu of the Shop tab, grouped: Money, Selling, Settings. Booking times only appear for a shop that sells services. */
export function shopNavGroups(sections: ShopSection[]): ShopNavGroup[] {
  const has = (id: ShopSectionId) => sections.find((s) => s.id === id);
  const item = (id: ShopSectionId): ShopNavItem[] => {
    const s = has(id);
    return s ? [{ key: id, label: s.label, help: s.help, section: id }] : [];
  };
  return [
    { label: "Money", items: (["money", "customers", "discounts", "delivery"] as ShopSectionId[]).flatMap(item) },
    { label: "Selling", items: (["bookings", "donations"] as ShopSectionId[]).flatMap(item) },
    { label: "Settings", items: SETTINGS_PARTS.map((p) => ({ key: `settings:${p.id}`, label: p.label, help: p.help, section: "settings" as const, part: p.id })) },
  ].filter((g) => g.items.length > 0);
}

/** Which menu entry is open for this section and settings part. */
export function currentShopNavKey(section: ShopSectionId, part: ShopSettingsPart): string {
  return section === "settings" ? `settings:${part}` : section;
}

export function parseShopSection(v: unknown): ShopSectionId | null {
  return typeof v === "string" && SHOP_SECTIONS.some((s) => s.id === v) ? (v as ShopSectionId) : null;
}
export function parseSettingsPart(v: unknown): ShopSettingsPart {
  return SETTINGS_PARTS.some((p) => p.id === v) ? (v as ShopSettingsPart) : "general";
}

/** Booking times only make sense for a shop that sells services; everyone else never sees them. */
export function shopSections(opts: { sellsServices?: boolean } = {}): ShopSection[] {
  return SHOP_SECTIONS.filter((s) => s.id !== "bookings" || opts.sellsServices !== false);
}

export function resolveShopSection(requested: unknown, sections: ShopSection[]): ShopSectionId {
  const wanted = parseShopSection(requested);
  return wanted && sections.some((s) => s.id === wanted) ? wanted : sections[0].id;
}

/** A shop tool as a hub address. */
export function shopHref(siteId: string, section: ShopSectionId = "money", part?: ShopSettingsPart): string {
  return `/dashboard/sites/${siteId}?tab=shop&section=${section}${part && section === "settings" ? `&part=${part}` : ""}`;
}

/** The old shop pages (by the end of their address, e.g. "wallet" or "settings:payments") and where each lives now. */
export const LEGACY_SHOP_PAGES: Record<string, { section: ShopSectionId; part?: ShopSettingsPart }> = {
  wallet: { section: "money" },
  customers: { section: "customers" },
  discounts: { section: "discounts" },
  delivery: { section: "delivery" },
  availability: { section: "bookings" },
  donations: { section: "donations" },
  "settings:general": { section: "settings", part: "general" },
  "settings:payments": { section: "settings", part: "payments" },
  "settings:checkout": { section: "settings", part: "checkout" },
  "settings:notifications": { section: "settings", part: "notifications" },
};

export function legacyShopHref(siteId: string, page: string): string | null {
  const to = LEGACY_SHOP_PAGES[page];
  return to ? shopHref(siteId, to.section, to.part) : null;
}
