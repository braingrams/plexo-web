/**
 * The emails Plexo sends to its own team, grouped the way staff think about them. Each admin can be switched on for any mix
 * (or all) of these in plexo-admin, and only a super admin can change it. Pure, so it is tested once and shared by both apps.
 */
export const ADMIN_ALERT_TOPICS = [
  { id: "testimonial", label: "New testimonials", help: "A customer review waiting to be approved or rejected." },
  { id: "feedback", label: "New feedback", help: "Product feedback customers send from the dashboard." },
  { id: "withdrawal", label: "Withdrawal requests", help: "Marketplace earnings and shop money a customer wants paid out." },
  { id: "access", label: "Access requests", help: "A customer asking for script access, or for card payments to be switched on." },
] as const;

export type AdminAlertTopic = (typeof ADMIN_ALERT_TOPICS)[number]["id"];
export const ADMIN_ALERT_TOPIC_IDS = ADMIN_ALERT_TOPICS.map((t) => t.id) as AdminAlertTopic[];

/** Used when nobody has switched a topic on, so a request is never missed. Set ADMIN_EMAIL to change it without a release. */
export const DEFAULT_ADMIN_ALERT_EMAIL = "moakinyemi8@gmail.com";

export type AdminAlertRoute = { email: string; name?: string; topics: AdminAlertTopic[] };
/** Who gets what, keyed by the admin's account id. Stored on the platform settings row. */
export type AdminAlertRoutes = Record<string, AdminAlertRoute>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Whatever was stored, reduced to routes that make sense (a real address and known topics only). Never throws. */
export function cleanAdminAlertRoutes(raw: unknown): AdminAlertRoutes {
  const out: AdminAlertRoutes = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [id, v] of Object.entries(raw as Record<string, unknown>).slice(0, 200)) {
    if (!v || typeof v !== "object") continue;
    const { email, name, topics } = v as { email?: unknown; name?: unknown; topics?: unknown };
    if (typeof email !== "string" || !EMAIL.test(email.trim()) || !Array.isArray(topics)) continue;
    const clean = ADMIN_ALERT_TOPIC_IDS.filter((t) => topics.includes(t));
    if (!clean.length) continue;
    out[id] = { email: email.trim().toLowerCase(), name: typeof name === "string" ? name.slice(0, 120) : undefined, topics: clean };
  }
  return out;
}

/** The addresses that should get an email about `topic`: every admin who switched it on, or the default address when none did. */
export function recipientsForTopic(topic: AdminAlertTopic, routes: AdminAlertRoutes, fallback: string): string[] {
  const emails = new Set<string>();
  for (const r of Object.values(routes)) if (r.topics.includes(topic)) emails.add(r.email);
  return emails.size ? [...emails] : [fallback];
}
