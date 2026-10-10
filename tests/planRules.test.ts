import { describe, expect, it } from "vitest";

import { accessDaysLeft, effectivePlan, paidAccess, planSyncAction, shouldOfferTrial } from "@/lib/plan/entitlement";
import { chooseSiteToKeep, findSecondaryPageLinks, planFreeLimits, planRestore, type PlanSite } from "@/lib/plan/siteLimits";
import { getTierFeatures, isHomePageOnlyPlan } from "@/lib/subscription";

const NOW = new Date("2026-10-10T12:00:00.000Z");
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();

describe("who keeps a paid plan", () => {
  it("a live Stripe subscription (active, trialing, or retrying a card) keeps it", () => {
    for (const status of ["ACTIVE", "TRIALING", "PAST_DUE"]) {
      expect(paidAccess({ subscriptionPlan: "PRO", stripeSubscriptionId: "sub_1", subscriptionStatus: status }, NOW)).toEqual({ entitled: true, basis: "SUBSCRIPTION" });
    }
  });

  it("an ended subscription doesn't", () => {
    expect(paidAccess({ subscriptionPlan: "PRO", stripeSubscriptionId: "sub_1", subscriptionStatus: "CANCELED" }, NOW)).toEqual({ entitled: false, reason: "PAYMENT_ENDED" });
    expect(paidAccess({ subscriptionPlan: "PRO", subscriptionStatus: "CANCELED" }, NOW)).toEqual({ entitled: false, reason: "PAYMENT_ENDED" });
  });

  it("a paid plan with no payment at all (set by hand, legacy) doesn't — it's downgraded", () => {
    expect(paidAccess({ subscriptionPlan: "ULTRA" }, NOW)).toEqual({ entitled: false, reason: "NO_PAYMENT" });
    expect(planSyncAction({ subscriptionPlan: "ULTRA" }, NOW)).toBe("downgrade");
    expect(effectivePlan({ subscriptionPlan: "ULTRA" }, NOW)).toBe("FREE");
  });

  it("the admin 'Keep on plan' switch keeps it with no payment, forever", () => {
    const kept = { subscriptionPlan: "PRO", planKeptByAdmin: true, planAccessUntil: days(-30), planAccessSource: "TRIAL" };
    expect(paidAccess(kept, NOW)).toEqual({ entitled: true, basis: "ADMIN_KEPT" });
    expect(effectivePlan(kept, NOW)).toBe("PRO");
    expect(planSyncAction(kept, NOW)).toBeNull();
  });

  it("a trial or admin grant keeps it until its date, then ends", () => {
    expect(paidAccess({ subscriptionPlan: "PRO", planAccessUntil: days(3), planAccessSource: "TRIAL" }, NOW)).toEqual({ entitled: true, basis: "TRIAL" });
    expect(paidAccess({ subscriptionPlan: "PRO", planAccessUntil: days(-1), planAccessSource: "TRIAL" }, NOW)).toEqual({ entitled: false, reason: "TRIAL_ENDED" });
    expect(paidAccess({ subscriptionPlan: "ULTRA", planAccessUntil: days(-1), planAccessSource: "ADMIN" }, NOW)).toEqual({ entitled: false, reason: "GRANT_ENDED" });
    expect(accessDaysLeft({ planAccessUntil: days(9.5) }, NOW)).toBe(10);
  });

  it("staff and Plexo's own system account are never billed", () => {
    expect(paidAccess({ subscriptionPlan: "ULTRA", adminRole: "SUPPORT" }, NOW).entitled).toBe(true);
    expect(paidAccess({ subscriptionPlan: "ULTRA", email: "templates@plexo.charisol.io" }, NOW).entitled).toBe(true);
  });

  it("a subscription recorded before statuses existed is trusted until the sweep checks Stripe", () => {
    expect(paidAccess({ subscriptionPlan: "PRO", stripeSubscriptionId: "sub_old" }, NOW)).toEqual({ entitled: true, basis: "SUBSCRIPTION_UNVERIFIED" });
  });
});

describe("what the lifecycle still owes an account", () => {
  it("paid again after a downgrade → restore", () => {
    expect(planSyncAction({ subscriptionPlan: "PRO", stripeSubscriptionId: "s", subscriptionStatus: "ACTIVE", planDowngradedAt: days(-5), freeLimitsAppliedAt: days(-5) }, NOW)).toBe("restore");
    expect(planSyncAction({ subscriptionPlan: "PRO", planKeptByAdmin: true, planDowngradedAt: days(-5) }, NOW)).toBe("restore");
  });

  it("Free without Free's limits applied yet (moved by an admin, or from before enforcement) → enforce", () => {
    expect(planSyncAction({ subscriptionPlan: "FREE" }, NOW)).toBe("enforce_free");
    expect(planSyncAction({ subscriptionPlan: "FREE", freeLimitsAppliedAt: days(-1) }, NOW)).toBeNull();
  });

  it("a paying account in good standing owes nothing", () => {
    expect(planSyncAction({ subscriptionPlan: "ULTRA", stripeSubscriptionId: "s", subscriptionStatus: "ACTIVE" }, NOW)).toBeNull();
  });
});

describe("the trial offer after signup", () => {
  const fresh = { subscriptionPlan: "FREE", createdAt: days(-1) };
  it("is shown to a new Free account once", () => {
    expect(shouldOfferTrial(fresh, NOW)).toBe(true);
    expect(shouldOfferTrial({ ...fresh, trialOfferSeenAt: days(0) }, NOW)).toBe(false);
    expect(shouldOfferTrial({ ...fresh, trialStartedAt: days(-20) }, NOW)).toBe(false);
  });
  it("isn't shown to old accounts, payers, or someone coming back from a downgrade", () => {
    expect(shouldOfferTrial({ ...fresh, createdAt: days(-60) }, NOW)).toBe(false);
    expect(shouldOfferTrial({ ...fresh, stripeSubscriptionId: "s" }, NOW)).toBe(false);
    expect(shouldOfferTrial({ ...fresh, planDowngradedAt: days(-2) }, NOW)).toBe(false);
  });
});

describe("Free plan limits", () => {
  it("Free: one live site, homepage only; paid: no caps", () => {
    expect(getTierFeatures("FREE")).toMatchObject({ maxPublishedSites: 1, maxPublishedPagesPerSite: 1, customDomainEnabled: false });
    expect(isHomePageOnlyPlan("FREE")).toBe(true);
    expect(isHomePageOnlyPlan("PRO")).toBe(false);
    expect(isHomePageOnlyPlan("ULTRA")).toBe(false);
  });
});

function site(id: string, over: Partial<PlanSite> = {}): PlanSite {
  return { id, name: id, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", pages: [], domains: [], ...over };
}
const sub = (templateId: string, id: string, extra = {}) => ({ id, templateId, domain: `${id}.plexopages.com`, type: "SUBDOMAIN" as const, ...extra });
const custom = (templateId: string, id: string, extra = {}) => ({ id, templateId, domain: `${id}.com`, type: "CUSTOM" as const, ...extra });

describe("downgrade: what goes offline", () => {
  const blog = site("blog", {
    updatedAt: "2026-09-01T00:00:00.000Z",
    pages: [{ id: "about", updatedAt: "2026-10-05T00:00:00.000Z" }, { id: "contact" }],
    domains: [sub("blog", "myblog"), custom("blog", "mybrand")],
  });
  const shop = site("shop", { updatedAt: "2026-10-01T00:00:00.000Z", pages: [{ id: "store" }], domains: [sub("shop", "myshop")] });
  const draft = site("draft", { updatedAt: "2026-10-09T00:00:00.000Z", pages: [{ id: "draft-p" }] }); // never published

  it("keeps the most recently edited LIVE site — an edit to any of its pages counts", () => {
    // blog's homepage is older than shop's, but its About page was edited last.
    expect(chooseSiteToKeep([shop, blog, draft])?.id).toBe("blog");
  });

  it("never deletes: unpublishes every secondary page, takes other sites offline, pauses custom domains", () => {
    const changes = planFreeLimits([blog, shop, draft]);
    expect(changes.keptSiteId).toBe("blog");
    expect(changes.disableDomainIds).toEqual([{ templateId: "blog", id: "mybrand" }, { templateId: "shop", id: "myshop" }]);
    expect(changes.archivePageIds.sort()).toEqual(["about", "contact", "draft-p", "store"]);
    expect(changes.needsFallbackSubdomain).toBe(false); // blog keeps myblog.plexopages.com
  });

  it("falls back to a Plexo address when the kept site only had a custom domain", () => {
    const onlyCustom = site("brand", { domains: [custom("brand", "brand")] });
    const changes = planFreeLimits([onlyCustom]);
    expect(changes.disableDomainIds).toEqual([{ templateId: "brand", id: "brand" }]);
    expect(changes.needsFallbackSubdomain).toBe(true);
  });

  it("leaves pages the owner already unpublished, suspended addresses, and sites another account keeps live alone", () => {
    const s = site("s", {
      pages: [{ id: "hidden", isPublished: false }, { id: "shown" }],
      domains: [sub("s", "abuse", { active: false }), sub("s", "ok")],
    });
    const shared = site("shared", { sharedWithOtherPlan: true, pages: [{ id: "team-page" }], domains: [] });
    const changes = planFreeLimits([s, shared]);
    expect(changes.archivePageIds).toEqual(["shown"]);
    expect(changes.disableDomainIds).toEqual([]);
  });

  it("switching which site is live brings that site's Plexo address back", () => {
    const a = site("a", { domains: [sub("a", "a")] });
    const b = site("b", { domains: [sub("b", "b", { planDisabledAt: "2026-10-01" })] });
    const changes = planFreeLimits([a, b], "b");
    expect(changes.keptSiteId).toBe("b");
    expect(changes.disableDomainIds).toEqual([{ templateId: "a", id: "a" }]);
    expect(changes.enableDomainIds).toEqual([{ templateId: "b", id: "b" }]);
    expect(changes.needsFallbackSubdomain).toBe(false);
  });
});

describe("upgrade: everything comes back exactly as it was", () => {
  it("restores only what the plan took away", () => {
    const sites = [
      site("blog", {
        pages: [{ id: "about", isPublished: false, planArchivedAt: "x" }, { id: "secret", isPublished: false }],
        domains: [custom("blog", "mybrand", { planDisabledAt: "x" }), sub("blog", "myblog")],
      }),
      site("shop", { pages: [{ id: "store", isPublished: false, planArchivedAt: "x" }], domains: [sub("shop", "myshop", { planDisabledAt: "x" })] }),
    ];
    expect(planRestore(sites)).toEqual({
      enableDomainIds: [{ templateId: "blog", id: "mybrand" }, { templateId: "shop", id: "myshop" }],
      republishPageIds: ["about", "store"], // "secret" was unpublished by the owner — stays unpublished
    });
  });
});

describe("links on the homepage that lead to other pages", () => {
  const html = `
    <nav><a href="/">Home</a><a href="/about">About us</a><a href="contact.html">Contact</a>
    <a href="https://mysite.plexopages.com/pricing/">Pricing</a><a href="https://twitter.com/x">Twitter</a>
    <a href="#features">Features</a><a href="mailto:hi@x.com">Email</a><a href="/brochure.pdf">Brochure</a>
    <a href="/about">About again</a><a href="/index.html">Home 2</a><a href="/blog/hello">Blog post</a></nav>`;
  it("finds page links (relative, same-site absolute), skips home, anchors, files, email and other sites", () => {
    expect(findSecondaryPageLinks(html, ["mysite.plexopages.com"])).toEqual([
      { href: "/about", label: "About us" },
      { href: "/contact.html", label: "Contact" },
      { href: "/pricing", label: "Pricing" },
      { href: "/blog/hello", label: "Blog post" },
    ]);
  });
});
