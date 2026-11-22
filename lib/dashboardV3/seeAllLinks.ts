/**
 * Where a "See all" on a Home card goes. Each kind of latest-activity card opens the real list it is a slice of
 * (orders -> the Orders tab, students -> the Course tab, messages -> the form replies), never just "the site".
 * Pure, so every card has one tested destination (tests/seeAllLinks.test.ts).
 */
import type { Experience } from "./nav";
import { advancedHref } from "./hubAdvanced";
import { hubTabHref } from "./hubTabs";

export type ActivityKind = "orders" | "students" | "messages" | "none";

export function seeAllHref(kind: ActivityKind, siteId: string, experience: Experience = "beginner"): string | null {
  switch (kind) {
    case "orders":
      return hubTabHref(siteId, "orders");
    case "students":
      return hubTabHref(siteId, "course");
    case "messages":
      // Pros read form replies inside Advanced; everyone else opens the replies page directly.
      return experience === "pro" ? advancedHref(siteId, "forms") : `/dashboard/templates/${siteId}/form-submissions`;
    default:
      return null;
  }
}

/** The tab (when it is a hub tab) a kind needs the site to have. Used by the audit test. */
export const ACTIVITY_KINDS: ActivityKind[] = ["orders", "students", "messages"];

/** Who a form reply is from, in the owner's words: a name, else an email, else the form's name. */
export function senderOf(fields: unknown, formName?: string | null): string {
  let f: Record<string, unknown> = {};
  if (fields && typeof fields === "object") {
    f = fields as Record<string, unknown>;
  } else if (typeof fields === "string") {
    try {
      const parsed = JSON.parse(fields);
      if (parsed && typeof parsed === "object") f = parsed;
    } catch {}
  }
  const first = Object.entries(f).find(([k]) => /first[-_]?name/i.test(k))?.[1];
  const last = Object.entries(f).find(([k]) => /last[-_]?name/i.test(k))?.[1];
  if (typeof first === "string" && first.trim() && typeof last === "string" && last.trim()) {
    return `${first.trim()} ${last.trim()}`;
  }
  const pick = (re: RegExp) => {
    for (const [k, v] of Object.entries(f)) if (re.test(k) && typeof v === "string" && v.trim()) return v.trim();
    return "";
  };
  return pick(/name/i) || pick(/e-?mail/i) || formName || "Someone";
}
