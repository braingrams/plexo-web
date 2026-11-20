/**
 * What the editor tells an owner about their plan, as plain data: a short headline for the one slim strip and a fuller
 * explanation for the popover behind it. Kept free of React so the wording and the priorities are tested
 * (tests/siteNotices.test.ts). The strip never stacks: it shows the most important headline and "and N more".
 */
import { PLAN, PLAN_LABELS, PLAN_RANK, toPlanId, type PaidPlanId } from "./plans";

export type SiteNoticeStatus = {
  plan: string;
  previousPlan: string | null;
  trialAvailable: boolean;
  homeOnly: boolean;
  isApp: boolean;
  /** The page being edited is a sub-page (not the homepage). */
  isSecondaryPage?: boolean;
  site: { id: string; name: string; isLive: boolean; liveAddress: string | null; pausedCustomDomains: string[]; everPublished: boolean } | null;
  otherLiveSite: { id: string; name: string } | null;
  pageCount: number;
  unpublishedPageCount: number;
  archivedByPlanPageCount: number;
  secondaryLinks: { href: string; label: string }[];
};

export type SiteNotice = {
  key: "offline" | "domain" | "this-page" | "pages" | "app" | "links";
  /** Most important first. */
  priority: number;
  headline: string;
  detail: string;
  /** The plan that fixes it (a trial of it is offered when the owner still has one). */
  need: PaidPlanId;
  upgradeLabel: string;
  /** The offline notice can also be fixed by making this the live site. */
  canMakeLive?: boolean;
  links?: { href: string; label: string }[];
};

export function previousPaidPlan(status: Pick<SiteNoticeStatus, "previousPlan">): PaidPlanId | null {
  const id = status.previousPlan ? toPlanId(status.previousPlan) : null;
  return id && id !== PLAN.FREE ? (id as PaidPlanId) : null;
}

/** Coming back from a paid plan, that plan (if it is enough); otherwise the cheapest plan that fixes it. */
export function planFor(status: Pick<SiteNoticeStatus, "previousPlan">, need: PaidPlanId): PaidPlanId {
  const prev = previousPaidPlan(status);
  return prev && PLAN_RANK[prev] >= PLAN_RANK[need] ? prev : need;
}

export function buildSiteNotices(status: SiteNoticeStatus): SiteNotice[] {
  if (!status.homeOnly || !status.site) return [];
  const prev = previousPaidPlan(status);
  const prevLabel = prev ? PLAN_LABELS[prev] : "Starter";
  const out: SiteNotice[] = [];
  const kind = status.isApp ? "app" : "site";

  if (!status.site.isLive && (status.site.everPublished || status.otherLiveSite)) {
    const paused = status.site.pausedCustomDomains[0];
    out.push({
      key: "offline",
      priority: 0,
      headline: `This ${kind} is offline right now`,
      detail:
        (status.otherLiveSite ? `The Free plan keeps one site live, and ${status.otherLiveSite.name} is live now.` : "The Free plan keeps one site live on a Plexo address.") +
        (paused ? ` Your domain ${paused} is paused, not removed.` : ""),
      need: PLAN.PRO,
      upgradeLabel: "Upgrade to Pro to keep both",
      canMakeLive: true,
    });
  } else if (status.site.isLive && status.site.pausedCustomDomains.length > 0) {
    out.push({
      key: "domain",
      priority: 1,
      headline: `Your domain ${status.site.pausedCustomDomains[0]} is paused`,
      detail: `Live at ${status.site.liveAddress ?? "your Plexo address"}. Your domain is paused on the Free plan and comes back the moment you upgrade.`,
      need: PLAN.STARTER,
      upgradeLabel: "Bring back my domain",
    });
  }

  // The page being edited is one Free doesn't publish: say so right here, with the way to fix it.
  if (!status.isApp && status.isSecondaryPage) {
    out.push({
      key: "this-page",
      priority: 2,
      headline: "This page won't be visible to visitors yet",
      detail: prev
        ? `It was archived when your ${prevLabel} plan ended. Reactivate ${prevLabel} and it goes live again.`
        : "The Free plan publishes only your homepage, so anyone who opens this page lands on the homepage instead. Upgrade to Starter to put it live.",
      need: PLAN.STARTER,
      upgradeLabel: prev ? `Reactivate ${prevLabel}` : "Upgrade to put it live",
    });
  }

  if (!status.isApp && status.pageCount > 1) {
    out.push({
      key: "pages",
      priority: 3,
      headline: prev ? `Your other pages are saved from ${prevLabel}` : "Only your homepage goes live on Free",
      detail: prev
        ? `Your other pages are kept from your ${prevLabel} plan. Reactivate ${prevLabel} to publish them, or keep only 1 page to keep editing on Free.`
        : "You can build and preview every page, but visitors can only open your homepage on the Free plan. Upgrade to Starter to put the rest live.",
      need: PLAN.STARTER,
      upgradeLabel: prev ? `Reactivate ${prevLabel}` : "Upgrade to Starter",
    });
  }

  if (status.isApp && status.site.isLive) {
    out.push({
      key: "app",
      priority: 4,
      headline: "Visitors only see your app's first screen on Free",
      detail: "On the Free plan visitors see your app's first screen. Other screens send them back to it.",
      need: PLAN.STARTER,
      upgradeLabel: "Upgrade to open every screen",
    });
  }

  const links = status.secondaryLinks;
  if (links.length > 0) {
    const n = links.length;
    out.push({
      key: "links",
      priority: 2,
      headline: `${n} link${n === 1 ? "" : "s"} on this page go${n === 1 ? "es" : ""} to pages that aren't live yet`,
      detail: `Visitors who click ${n === 1 ? "it" : "them"} land back on this homepage until those pages are published.`,
      need: PLAN.STARTER,
      upgradeLabel: "Publish those pages",
      links,
    });
  }

  return out.sort((a, b) => a.priority - b.priority);
}

/** The single line shown in the strip: the most important headline, plus how many more are in the popover. */
export function stripHeadline(notices: SiteNotice[]): string {
  if (notices.length === 0) return "";
  const rest = notices.length - 1;
  return rest > 0 ? `${notices[0].headline} · and ${rest} more` : notices[0].headline;
}

/** Remembered for this browser tab only, per site: a dismissed notice comes back next time the owner opens the editor. */
export function dismissKey(templateId: string): string {
  return `plexo.siteNotice.dismissed.${templateId}`;
}
