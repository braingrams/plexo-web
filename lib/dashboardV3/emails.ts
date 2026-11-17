import type { PlanId } from "@/lib/plan/plans";
import { getTierFeatures } from "@/lib/subscription";

/** Just the fields of a template row the emails library needs to decide what it is. */
export type TemplateLike = {
  id: string;
  kind?: string | null;
  parentId?: string | null;
  marketplaceStatus?: string | null;
  isBlogLayout?: boolean | null;
  isSiteLayoutFragment?: boolean | null;
  isCommerceLayout?: boolean | null;
  isLmsPageDesign?: boolean | null;
};

/**
 * An email in the owner's library: a top-level EMAIL template. Sites, landing pages, course
 * designs, blog layouts and marketplace listing copies are never emails, whatever else is true.
 * The same rule the plan limit counts (app/api/templates/route.ts) so the meter never disagrees.
 */
export function isLibraryEmail(t: TemplateLike): boolean {
  return t.kind === "EMAIL" && !t.parentId && !t.marketplaceStatus && !t.isBlogLayout && !t.isSiteLayoutFragment && !t.isCommerceLayout && !t.isLmsPageDesign;
}

export function emailLimitFor(plan: PlanId): number {
  return getTierFeatures(plan).maxEmailTemplates;
}

export type EmailUsage = { used: number; limit: number; remaining: number; atLimit: boolean; nearLimit: boolean; label: string; percent: number };

export function emailUsage(used: number, limit: number): EmailUsage {
  const remaining = Math.max(0, limit - used);
  const atLimit = used >= limit;
  return {
    used,
    limit,
    remaining,
    atLimit,
    nearLimit: !atLimit && limit > 0 && remaining <= Math.max(1, Math.floor(limit * 0.2)),
    label: `${used} of ${limit} email${limit === 1 ? "" : "s"}`,
    percent: limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 100,
  };
}

export function filterEmails<T extends { name: string }>(emails: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  return q ? emails.filter((e) => e.name.toLowerCase().includes(q)) : emails;
}

/** "Edited today", "Edited 3 days ago", "Edited 12 Mar". */
export function editedLabel(iso: string, now: Date = new Date()): string {
  const days = Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "Edited today";
  if (days === 1) return "Edited yesterday";
  if (days < 14) return `Edited ${days} days ago`;
  return `Edited ${new Date(iso).toLocaleDateString("en", { day: "numeric", month: "short" })}`;
}
