import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// End to end through the REAL Stripe webhook route and the real lib/plan code, on an
// in-memory database (tests/helpers/planFakeDb.ts). Only the edges are faked: Stripe's
// signature check, email, credits and funnel-slot bookkeeping.

const sent = vi.hoisted(() => ({ emails: [] as { to: string; subject: string; html?: string }[], claimed: new Set<string>(), subs: {} as Record<string, unknown> }));

vi.mock("@/lib/db/client", async () => {
  const { fakeDb } = await import("./helpers/planFakeDb");
  return { docClient: fakeDb.docClient, TABLES: { core: "core", content: "content" } };
});
vi.mock("@/lib/db/coreEntities", async () => {
  const { fakeDb } = await import("./helpers/planFakeDb");
  return { User: fakeDb.User, Member: fakeDb.Member, PlatformSettings: {} };
});
vi.mock("@/lib/db/contentEntities", async () => {
  const { fakeDb } = await import("./helpers/planFakeDb");
  return { Template: fakeDb.Template, PublishedDomain: fakeDb.PublishedDomain, TemplatePurchase: {} };
});
vi.mock("@/lib/db/ledgerEntities", () => ({
  SellerLedgerEntry: {},
  StripeEvent: {
    create: ({ id }: { id: string }) => ({
      go: async () => {
        if (sent.claimed.has(id)) throw Object.assign(new Error("dup"), { name: "ConditionalCheckFailedException" });
        sent.claimed.add(id);
      },
    }),
  },
}));
vi.mock("@/lib/stripe", () => ({ getStripe: () => ({ webhooks: { constructEvent: (body: string) => JSON.parse(body) }, subscriptions: { retrieve: async (id: string) => { if (!sent.subs[id]) throw new Error("no such subscription"); return sent.subs[id]; }, list: async function* () {} } }) }));
vi.mock("@/lib/db/ledgerOperations", () => ({ grantTopup: vi.fn(), grantPlanChangeAllowance: vi.fn(async () => {}) }));
vi.mock("@/lib/credits/topupOffer", () => ({ creditsForCompletedTopup: () => null }));
vi.mock("@/lib/marketplaceListing", () => ({ getMarketplaceOwnerUserId: async () => null }));
vi.mock("@/lib/lms/activateFunnelAddonSlot", () => ({ handleLmsAddonSlotSubscriptionUpdate: vi.fn(), handleLmsAddonSlotSubscriptionDeleted: vi.fn() }));
vi.mock("@/lib/lms/funnelSlots", () => ({ reconcileFunnelSlotsForOrg: vi.fn(async () => {}) }));
vi.mock("@/lib/mail/maildrip", () => ({
  emailShell: ({ bodyHtml }: { bodyHtml: string }) => bodyHtml,
  sendMaildripEmail: vi.fn(async (m: { to: string; subject: string; html?: string }) => void sent.emails.push(m)),
}));
vi.mock("@/lib/mail/logEmail", () => ({ logEmailDelivery: vi.fn() }));
vi.mock("@/server/pagesDomain", () => ({ getPagesDomain: () => "plexopages.com" }));
vi.mock("@/lib/cloudfrontDomains", () => ({ requestCustomDomainConnection: vi.fn() }));

import { POST as stripeWebhook } from "@/app/api/webhooks/stripe/route";
import { syncPlanLifecycle, startTrial, makeSiteLive } from "@/lib/plan/lifecycle";
import { fakeDb, resetFakeDb } from "./helpers/planFakeDb";

process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
process.env.STRIPE_SECRET_KEY = "sk_test_x";

let eventSeq = 0;
function stripeEvent(type: string, subscription: Record<string, unknown>) {
  const body = JSON.stringify({ id: `evt_${++eventSeq}`, type, data: { object: subscription } });
  return stripeWebhook(new NextRequest("https://plexo.test/api/webhooks/stripe", { method: "POST", body, headers: { "stripe-signature": "t=1,v1=x" } }));
}
const sub = (id: string, status: string, plan = "PRO") => ({ id, status, metadata: { plexoUserId: "u1", plan, planVersion: "2" } });

const PAGE_EDITED = "2026-10-05T00:00:00.000Z";

function seed(userOverrides: Record<string, unknown> = {}) {
  resetFakeDb();
  sent.emails.length = 0;
  fakeDb.users.set("u1", { id: "u1", email: "owner@example.com", subscriptionPlan: "PRO", planVersion: 2, stripeSubscriptionId: "sub_1", subscriptionStatus: "ACTIVE", ...userOverrides });
  fakeDb.members.push({ userId: "u1", organizationId: "org1", role: "owner" });
  const t = (id: string, extra: Record<string, unknown>) => fakeDb.templates.set(id, { id, userId: "u1", organizationId: "org1", kind: "LANDING_PAGE", name: id, createdAt: "2026-01-01T00:00:00.000Z", ...extra });
  // "blog" — its homepage is older than "shop", but its About page was edited most recently.
  t("blog", { name: "My Blog", updatedAt: "2026-09-01T00:00:00.000Z" });
  t("about", { parentId: "blog", slug: "about", updatedAt: PAGE_EDITED });
  t("contact", { parentId: "blog", slug: "contact", updatedAt: "2026-08-01T00:00:00.000Z" });
  t("shop", { name: "My Shop", updatedAt: "2026-10-01T00:00:00.000Z" });
  t("store", { parentId: "shop", slug: "store", updatedAt: "2026-07-01T00:00:00.000Z" });
  const d = (templateId: string, id: string, domain: string, type: string) => fakeDb.domains.push({ id, templateId, userId: "u1", organizationId: "org1", domain, type, active: true });
  d("blog", "d-blog", "myblog.plexopages.com", "SUBDOMAIN");
  d("blog", "d-brand", "mybrand.com", "CUSTOM");
  d("shop", "d-shop", "myshop.plexopages.com", "SUBDOMAIN");
}

const page = (id: string) => fakeDb.templates.get(id)!;
const domain = (id: string) => fakeDb.domains.find((d) => d.id === id)!;
const user = () => fakeDb.users.get("u1")!;

describe("subscription ends (Stripe customer.subscription.deleted)", () => {
  beforeEach(() => seed());

  it("unpublishes every secondary page automatically — nothing is deleted", async () => {
    const res = await stripeEvent("customer.subscription.deleted", sub("sub_1", "canceled"));
    expect(res.status).toBe(200);

    for (const id of ["about", "contact", "store"]) {
      expect(page(id).isPublished).toBe(false);
      expect(page(id).planArchivedAt).toEqual(expect.any(String));
    }
    // The homepages stay published, and every page still exists.
    expect(page("blog").isPublished).toBeUndefined();
    expect(fakeDb.templates.size).toBe(5);
    // Unpublishing didn't count as an edit.
    expect(page("about").updatedAt).toBe(PAGE_EDITED);
  });

  it("keeps the last-edited site live on its Plexo address, takes the other site offline, pauses the custom domain", async () => {
    await stripeEvent("customer.subscription.deleted", sub("sub_1", "canceled"));
    expect(domain("d-blog").planDisabledAt).toBeUndefined(); // myblog.plexopages.com stays live
    expect(domain("d-brand").planDisabledAt).toEqual(expect.any(String)); // custom domain paused, row + certificate kept
    expect(domain("d-shop").planDisabledAt).toEqual(expect.any(String)); // the other site goes offline
    expect(fakeDb.domains).toHaveLength(3);
  });

  it("moves the account to Free, says why, and emails the owner", async () => {
    await stripeEvent("customer.subscription.deleted", sub("sub_1", "canceled"));
    expect(user()).toMatchObject({ subscriptionPlan: "FREE", subscriptionStatus: "CANCELED", planBeforeDowngrade: "PRO", planDowngradeReason: "PAYMENT_ENDED" });
    expect(user().stripeSubscriptionId).toBeUndefined();
    expect(user().freeLimitsAppliedAt).toEqual(expect.any(String));
    expect(user().planSyncLockUntil).toBeUndefined();
    expect(sent.emails).toHaveLength(1);
    expect(sent.emails[0]).toMatchObject({ to: "owner@example.com", subject: expect.stringMatching(/ended — nothing was deleted/) });
  });

  it("an OLD subscription ending after an upgrade changes nothing", async () => {
    await stripeEvent("customer.subscription.deleted", sub("sub_old", "canceled"));
    expect(user().subscriptionPlan).toBe("PRO");
    expect(page("about").isPublished).toBeUndefined();
  });

  it("an account an admin keeps on its plan is never downgraded", async () => {
    seed({ planKeptByAdmin: true });
    await stripeEvent("customer.subscription.deleted", sub("sub_1", "canceled"));
    expect(user().subscriptionPlan).toBe("PRO");
    expect(page("about").isPublished).toBeUndefined();
    expect(domain("d-brand").planDisabledAt).toBeUndefined();
  });

  it("a failing card (past_due) keeps the plan while Stripe retries; unpaid ends it", async () => {
    await stripeEvent("customer.subscription.updated", sub("sub_1", "past_due"));
    expect(user()).toMatchObject({ subscriptionPlan: "PRO", subscriptionStatus: "PAST_DUE" });
    expect(page("about").isPublished).toBeUndefined();

    await stripeEvent("customer.subscription.updated", sub("sub_1", "unpaid"));
    expect(user().subscriptionPlan).toBe("FREE");
    expect(page("about").isPublished).toBe(false);
  });
});

describe("paying again brings everything back exactly as it was", () => {
  beforeEach(() => seed());

  it("every page, every site and the custom domain return the moment the subscription is active", async () => {
    // The owner had deliberately unpublished Contact before any of this.
    fakeDb.templates.get("contact")!.isPublished = false;
    await stripeEvent("customer.subscription.deleted", sub("sub_1", "canceled"));
    expect(page("about").isPublished).toBe(false);

    await stripeEvent("customer.subscription.updated", sub("sub_2", "active", "PRO"));

    expect(user()).toMatchObject({ subscriptionPlan: "PRO", stripeSubscriptionId: "sub_2", subscriptionStatus: "ACTIVE" });
    expect(user().planDowngradedAt).toBeUndefined();
    expect(user().freeLimitsAppliedAt).toBeUndefined();
    expect(page("about").isPublished).toBe(true);
    expect(page("about").planArchivedAt).toBeUndefined();
    expect(page("store").isPublished).toBe(true);
    expect(page("contact").isPublished).toBe(false); // the owner's own choice is kept
    for (const id of ["d-blog", "d-brand", "d-shop"]) expect(domain(id).planDisabledAt).toBeUndefined();
  });

  it("an admin switching the account back to a paid plan restores it too (on the next sync)", async () => {
    await stripeEvent("customer.subscription.deleted", sub("sub_1", "canceled"));
    // plexo-admin only writes these facts…
    Object.assign(fakeDb.users.get("u1")!, { subscriptionPlan: "ULTRA", planKeptByAdmin: true });
    // …and the next dashboard load / site visit / sweep finishes the job.
    expect(await syncPlanLifecycle("u1")).toEqual(["restore"]);
    expect(domain("d-brand").planDisabledAt).toBeUndefined();
    expect(page("about").isPublished).toBe(true);
  });
});

describe("the 14-day trial", () => {
  beforeEach(() => seed({ subscriptionPlan: "FREE", stripeSubscriptionId: undefined, subscriptionStatus: undefined }));

  it("starts once, with no card, and ends in the normal downgrade", async () => {
    const start = new Date("2026-10-10T12:00:00.000Z");
    const { endsAt } = await startTrial("u1", "PRO", start);
    expect(endsAt).toBe("2026-10-24T12:00:00.000Z");
    expect(user()).toMatchObject({ subscriptionPlan: "PRO", planAccessSource: "TRIAL", planAccessUntil: endsAt });
    await expect(startTrial("u1", "PRO", start)).rejects.toThrow(/already used your free trial/);

    // Day 13: nothing happens.
    expect(await syncPlanLifecycle("u1", new Date("2026-10-23T12:00:00.000Z"))).toEqual([]);
    // Day 15: the trial is over.
    expect(await syncPlanLifecycle("u1", new Date("2026-10-25T12:00:00.000Z"))).toEqual(["downgrade"]);
    expect(user()).toMatchObject({ subscriptionPlan: "FREE", planDowngradeReason: "TRIAL_ENDED", planBeforeDowngrade: "PRO" });
    expect(page("about").isPublished).toBe(false);
  });
});

describe("plan-ending reminders through the sweep", () => {
  beforeEach(() => seed({ subscriptionPlan: "PRO", stripeSubscriptionId: undefined, subscriptionStatus: undefined, planAccessSource: "TRIAL", planAccessUntil: "2026-11-14T15:00:00.000Z" }));

  it("emails a trial user a week out, a day out and on the day — once each — then the plan-ended email", async () => {
    const { runPlanSweep } = await import("@/lib/plan/sweep");
    const run = async (iso: string) => (await runPlanSweep({ now: new Date(iso) })).reminded;
    expect(await run("2026-11-05T00:00:00Z")).toBe(0); // 9 days out
    expect(await run("2026-11-08T00:00:00Z")).toBe(1);
    expect(await run("2026-11-08T01:00:00Z")).toBe(0); // the next hourly run doesn't repeat it
    expect(await run("2026-11-13T16:00:00Z")).toBe(1);
    expect(await run("2026-11-14T08:00:00Z")).toBe(1);
    expect(sent.emails.map((e) => e.subject)).toEqual([
      "Your Pro trial ends in 7 days — Plexo",
      "Your Pro trial ends in 1 day — Plexo",
      "Your Pro trial ends today — Plexo",
    ]);
    expect(sent.emails.every((e) => e.to === "owner@example.com")).toBe(true);

    await run("2026-11-14T16:00:00Z"); // it has ended → the account moves to Free and is told
    expect(sent.emails.at(-1)!.subject).toMatch(/ended — nothing was deleted|follow the Free plan/);
    expect(user().subscriptionPlan).toBe("FREE");
  });

  it("tells a subscriber who cancelled that their plan ends", async () => {
    const { runPlanSweep } = await import("@/lib/plan/sweep");
    seed({ subscriptionPeriodEnd: "2026-11-14T15:00:00.000Z", subscriptionCancelAtPeriodEnd: true });
    expect((await runPlanSweep({ now: new Date("2026-11-08T00:00:00Z") })).reminded).toBe(1);
    expect(sent.emails[0].subject).toBe("Your Pro plan ends in 7 days — Plexo");
  });

  it("tells a renewing subscriber, once, a week ahead — with the amount — that it renews", async () => {
    const { runPlanSweep } = await import("@/lib/plan/sweep");
    seed({ subscriptionPeriodEnd: "2026-11-14T15:00:00.000Z", subscriptionCancelAtPeriodEnd: false });
    sent.subs["sub_1"] = { id: "sub_1", items: { data: [{ price: { unit_amount: 1900, currency: "usd" } }] } };
    expect((await runPlanSweep({ now: new Date("2026-11-06T00:00:00Z") })).reminded).toBe(0); // 8 days out
    expect((await runPlanSweep({ now: new Date("2026-11-08T00:00:00Z") })).reminded).toBe(1);
    expect((await runPlanSweep({ now: new Date("2026-11-08T01:00:00Z") })).reminded).toBe(0);
    expect((await runPlanSweep({ now: new Date("2026-11-13T16:00:00Z") })).reminded).toBe(0); // no countdown for a renewal
    expect(sent.emails).toHaveLength(1);
    expect(sent.emails[0].subject).toBe("Your Pro plan renews on November 14 — Plexo");
    expect(sent.emails[0].html).toContain("$19.00");
    expect(user().subscriptionPlan).toBe("PRO"); // still on the plan — nothing was downgraded
  });
});

describe("a declined renewal (Stripe invoice.payment_failed)", () => {
  const invoice = (extra: Record<string, unknown> = {}) => ({ id: "in_1", billing_reason: "subscription_cycle", attempt_count: 1, amount_due: 1900, currency: "usd", next_payment_attempt: Date.parse("2026-11-17T09:00:00Z") / 1000, parent: { subscription_details: { subscription: "sub_1" } }, ...extra });
  beforeEach(() => {
    seed();
    sent.subs["sub_1"] = { id: "sub_1", metadata: { plexoUserId: "u1", plan: "PRO", planVersion: "2" } };
  });

  it("emails the owner that the payment was declined, while the plan stays fully active", async () => {
    const res = await stripeEvent("invoice.payment_failed", invoice());
    expect(res.status).toBe(200);
    expect(sent.emails).toHaveLength(1);
    expect(sent.emails[0]).toMatchObject({ to: "owner@example.com", subject: "Your payment didn't go through — update your card to keep Pro" });
    expect(sent.emails[0].html).toContain("November 17");
    expect(user().subscriptionPlan).toBe("PRO");
    expect(page("about").isPublished).toBeUndefined(); // nothing taken offline yet — Stripe is still retrying
  });

  it("emails only on the first failed attempt, not on Stripe's later retries", async () => {
    const first = invoice();
    await stripeEvent("invoice.payment_failed", first);
    await stripeEvent("invoice.payment_failed", invoice({ attempt_count: 2 }));
    await stripeEvent("invoice.payment_failed", invoice({ attempt_count: 3 }));
    expect(sent.emails).toHaveLength(1);
  });

  it("ignores a failed first payment, a superseded subscription and a funnel add-on slot", async () => {
    await stripeEvent("invoice.payment_failed", invoice({ billing_reason: "subscription_create" }));
    sent.subs["sub_old"] = { id: "sub_old", metadata: { plexoUserId: "u1", plan: "PRO", planVersion: "2" } };
    await stripeEvent("invoice.payment_failed", invoice({ parent: { subscription_details: { subscription: "sub_old" } } }));
    sent.subs["sub_slot"] = { id: "sub_slot", metadata: { plexoUserId: "u1", kind: "lms_addon_slot" } };
    await stripeEvent("invoice.payment_failed", invoice({ parent: { subscription_details: { subscription: "sub_slot" } } }));
    expect(sent.emails).toHaveLength(0);
  });

  it("if every retry fails, the plan-ended email says what went offline and how to get it back", async () => {
    await stripeEvent("invoice.payment_failed", invoice());
    await stripeEvent("customer.subscription.deleted", sub("sub_1", "canceled"));
    expect(sent.emails).toHaveLength(2);
    expect(sent.emails[1].subject).toMatch(/ended — nothing was deleted/);
    expect(page("about").isPublished).toBe(false);
  });
});

describe("Free: choosing which site is live", () => {
  beforeEach(() => seed());

  it("the kept site falls back to a Plexo address when it only had a custom domain", async () => {
    fakeDb.domains.splice(fakeDb.domains.findIndex((d) => d.id === "d-blog"), 1); // blog = custom domain only
    await stripeEvent("customer.subscription.deleted", sub("sub_1", "canceled"));
    const fallback = fakeDb.domains.find((d) => d.planFallback);
    expect(fallback).toMatchObject({ templateId: "blog", type: "SUBDOMAIN", domain: "my-blog.plexopages.com" });
    expect(domain("d-brand").planDisabledAt).toEqual(expect.any(String));
  });

  it("switching the live site takes the other offline and brings this one back", async () => {
    await stripeEvent("customer.subscription.deleted", sub("sub_1", "canceled"));
    await makeSiteLive("u1", "shop");
    expect(domain("d-shop").planDisabledAt).toBeUndefined();
    expect(domain("d-blog").planDisabledAt).toEqual(expect.any(String));
  });
});
