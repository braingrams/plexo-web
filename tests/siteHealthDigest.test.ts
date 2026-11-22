import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  settings: new Map<string, Record<string, any>>(),
  templates: new Map<string, Record<string, any>>(),
  users: new Map<string, Record<string, any>>(),
  domains: [] as Record<string, any>[],
  status: new Map<string, any>(),
  sent: [] as { to: string; subject: string; html: string }[],
  failFor: null as string | null,
}));

vi.mock("@/lib/db/opsEntities", () => ({
  SiteHealthSettings: {
    get: ({ templateId }: { templateId: string }) => ({ go: async () => ({ data: h.settings.get(templateId) ?? null }) }),
    upsert: (item: { templateId: string }) => ({ go: async () => void h.settings.set(item.templateId, { ...(h.settings.get(item.templateId) ?? {}), ...item }) }),
  },
}));
vi.mock("@/lib/db/contentEntities", () => ({
  Template: { get: ({ id }: { id: string }) => ({ go: async () => ({ data: h.templates.get(id) ?? null }) }) },
  PublishedDomain: { scan: { where: () => ({ go: async () => ({ data: h.domains, cursor: null }) }) } },
}));
vi.mock("@/lib/db/coreEntities", () => ({ User: { get: ({ id }: { id: string }) => ({ go: async () => ({ data: h.users.get(id) ?? null }) }) } }));
vi.mock("@/lib/mail/maildrip", () => ({
  emailShell: (i: { title: string; bodyHtml: string; unsubscribeUrl?: string; preheader?: string }) => `<html><title>${i.title}</title>${i.bodyHtml}${i.unsubscribeUrl ? `<a href="${i.unsubscribeUrl}">Unsubscribe</a>` : ""}</html>`,
  sendMaildripEmail: async (m: { to: string; subject: string; html: string }) => {
    if (h.failFor && m.to === h.failFor) throw new Error("mail down");
    h.sent.push(m);
  },
}));
vi.mock("@/lib/siteHealth/service", () => ({ loadHealthStatus: async (id: string) => h.status.get(id) ?? { last: null, settings: {} }, WEEKLY_MS: 7 * 86_400_000 }));
vi.mock("@/lib/siteHealth/recheck", () => ({ takeJobLock: async () => true }));
vi.mock("@/server/adminAuth", () => ({ isAuthorizedAdmin: () => false }));

import { composeDigest, digestDue, DIGEST_MIN_GAP_MS, scoreChanges, scoresOf, sendWeeklyDigests, setDigestEnabled, unsubscribeUrlFor, verifyUnsubscribe } from "@/lib/siteHealth/digest";
import { buildSiteHealthDigestEmail } from "@/lib/mail/templates";
import { toView } from "@/lib/siteHealth/serve";
import type { HealthReport } from "@/lib/siteHealth/types";

const speed = (score: number, extra: Record<string, unknown> = {}) => ({ speed: score, seo: 92, accessibility: 88, bestPractices: 95, lcp: { value: 5.2, rating: "poor" }, inp: null, cls: { value: 0.3, rating: "poor" }, fcp: null, tbt: null, inpEstimated: false, fieldScope: null, opportunities: [{ id: "uses-optimized-images", savingsMs: 1800 }], elements: {}, failedAudits: ["uses-optimized-images", "unsized-images"], hasRealVisitorData: false, ...extra });
const report = (phone: number, desktop = 90, aeo = 61): HealthReport => ({ url: "https://mama.plexopages.io", speed: speed(phone) as any, desktop: speed(desktop) as any, aeo: { score: aeo, checks: [{ id: "meta_description", passed: false, weight: 10, detail: "" }, { id: "llms_txt", passed: false, weight: 10, detail: "" }] } });
const settings = toView(null);

const NOW = Date.parse("2026-11-19T08:00:00Z");
const DAY = 86_400_000;

beforeEach(() => {
  process.env.AUTH_SECRET = "test-auth-secret";
  process.env.NEXT_PUBLIC_APP_URL = "https://app.test";
  h.settings.clear(); h.templates.clear(); h.users.clear(); h.status.clear(); h.sent.length = 0; h.domains = []; h.failFor = null;
});

function addSite(id: string, opts: { phone?: number; checkedAgo?: number; email?: string | null } = {}) {
  h.domains.push({ templateId: id, active: true });
  h.templates.set(id, { id, name: `Site ${id}`, organizationId: "org1", userId: `u-${id}`, kind: "LANDING_PAGE" });
  if (opts.email !== null) h.users.set(`u-${id}`, { email: opts.email ?? `${id}@owner.test` });
  h.status.set(id, { last: { createdAt: new Date(NOW - (opts.checkedAgo ?? DAY)).toISOString(), report: report(opts.phone ?? 38) }, settings, facts: { productCount: 0 } });
}

describe("what the email says", () => {
  it("shows each score with how it moved since the last email", () => {
    const rows = scoreChanges(scoresOf(report(70)), { speed: 50, computer: 90, search: 95, ai: null });
    expect(rows.find((r) => r.label === "Speed on phones")).toMatchObject({ score: 70, change: 20 });
    expect(rows.find((r) => r.label === "Speed on computers")?.change).toBe(0);
    expect(rows.find((r) => r.label === "Findable in search")?.change).toBe(-3);
    expect(rows.find((r) => r.label === "Findable by AI assistants")?.change).toBeNull();
    expect(scoreChanges(scoresOf(report(70)), null).every((r) => r.change === null)).toBe(true);
  });

  it("picks the top three problems in plain words, with a link that opens Site health", () => {
    const mail = composeDigest({ siteName: "Mama Tee", siteId: "s1", report: report(38), settings, before: null, unsubscribeUrl: "https://u" });
    expect(mail.fixes.length).toBeLessThanOrEqual(3);
    expect(mail.fixes.length).toBeGreaterThan(0);
    for (const f of mail.fixes) expect(`${f.title} ${f.why}`).not.toMatch(/LCP|CLS|INP|Lighthouse|audit/i);
    expect(mail.openUrl).toBe("https://app.test/dashboard/sites/s1?tab=health");
    expect(mail.headline).toMatch(/slow/i);
  });

  it("renders a slow site: scores, falling numbers, fixes, one button and an unsubscribe link", () => {
    const mail = composeDigest({ siteName: "Mama <Tee>", siteId: "s1", report: report(38), settings, before: { speed: 55, computer: 90, search: 92, ai: 61 }, unsubscribeUrl: "https://app.test/u?x=1" });
    const { subject, html, preheader } = buildSiteHealthDigestEmail(mail);
    expect(subject).toContain("Mama <Tee>");
    expect(preheader).toMatch(/worth fixing/);
    expect(html).toContain("Mama &lt;Tee&gt;");
    expect(html).not.toContain("Mama <Tee>");
    expect(html).toContain("down 17");
    expect(html).toContain("Since last week: speed on phones went down 17");
    expect(html).toContain("Speed on phones");
    expect(html).toContain("https://app.test/dashboard/sites/s1?tab=health");
    expect(html).toContain("See and fix it");
    expect(html).toContain('href="https://app.test/u?x=1"');
  });

  it("renders a healthy site with nothing to fix, and a first email with nothing to compare", () => {
    const mail = { siteName: "Ok", headline: "Your site is fast.", scores: [{ label: "Speed on phones", score: 97, change: null }], fixes: [], moreCount: 0, openUrl: "https://x", unsubscribeUrl: "https://u" };
    const { html, preheader } = buildSiteHealthDigestEmail(mail);
    expect(preheader).toMatch(/Nothing needs fixing/);
    expect(html).toContain("Open Site health");
    expect(html).toContain("first weekly check-in");
    expect(html).not.toContain("things to fix first");
  });
});

describe("who gets it, and when", () => {
  it("is due only with the email on, a recent check, and no email in the last 6 days", () => {
    const base = { enabled: true, lastCheckAt: new Date(NOW - DAY).toISOString(), lastSentAt: null, now: NOW };
    expect(digestDue(base)).toBe(true);
    expect(digestDue({ ...base, enabled: false })).toBe(false);
    expect(digestDue({ ...base, lastCheckAt: null })).toBe(false);
    expect(digestDue({ ...base, lastCheckAt: new Date(NOW - 10 * DAY).toISOString() })).toBe(false);
    expect(digestDue({ ...base, lastSentAt: new Date(NOW - 2 * DAY).toISOString() })).toBe(false);
    expect(digestDue({ ...base, lastSentAt: new Date(NOW - DIGEST_MIN_GAP_MS - 1000).toISOString() })).toBe(true);
  });

  it("emails each owner once, records what was sent, and does not email again the next day", async () => {
    addSite("a", { phone: 38 });
    expect(await sendWeeklyDigests({ now: NOW })).toMatchObject({ sent: 1, failed: 0 });
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].to).toBe("a@owner.test");
    expect(h.sent[0].html).toContain("/api/public/site-health/unsubscribe?site=a&amp;sig=".replace("&amp;", "&"));
    expect(h.settings.get("a")).toMatchObject({ digestScores: { speed: 38, computer: 90, search: 92, ai: 61 } });
    expect((await sendWeeklyDigests({ now: NOW + DAY })).sent).toBe(0);
    expect(h.sent).toHaveLength(1);
  });

  it("the next week's email reports what changed since this one", async () => {
    addSite("a", { phone: 38 });
    await sendWeeklyDigests({ now: NOW });
    h.status.get("a").last = { createdAt: new Date(NOW + 6 * DAY).toISOString(), report: report(72) };
    await sendWeeklyDigests({ now: NOW + 7 * DAY });
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1].html).toContain("up 34");
  });

  it("skips owners who switched it off, sites never checked, stale checks and owners with no email, and carries on after a failure", async () => {
    addSite("off"); h.settings.set("off", { digestOff: true });
    addSite("stale", { checkedAgo: 20 * DAY });
    addSite("noemail", { email: null });
    h.domains.push({ templateId: "never", active: true }); h.templates.set("never", { id: "never", name: "N", organizationId: "o", userId: "u-never", kind: "LANDING_PAGE" });
    addSite("boom"); h.failFor = "boom@owner.test";
    addSite("fine");
    const out = await sendWeeklyDigests({ now: NOW });
    expect(out).toMatchObject({ sent: 1, failed: 1 });
    expect(h.sent.map((m) => m.to)).toEqual(["fine@owner.test"]);
    expect(h.settings.get("boom")?.digestSentAt).toBeUndefined();
  });

  it("stops at its per-run limit", async () => {
    for (const id of ["a", "b", "c"]) addSite(id);
    expect((await sendWeeklyDigests({ now: NOW, max: 2 })).sent).toBe(2);
  });
});

describe("the owner's switch and the unsubscribe link", () => {
  it("is on by default and shows as off once switched off", async () => {
    expect(toView(null).emailDigest).toBe(true);
    expect(toView({}).emailDigest).toBe(true);
    await setDigestEnabled({ id: "a", organizationId: "org1" }, false);
    expect(toView(h.settings.get("a")).emailDigest).toBe(false);
    await setDigestEnabled({ id: "a", organizationId: "org1" }, true);
    expect(toView(h.settings.get("a")).emailDigest).toBe(true);
  });

  it("the link only works for the site it was made for", () => {
    const url = new URL(unsubscribeUrlFor("site-1"));
    const sig = url.searchParams.get("sig");
    expect(verifyUnsubscribe("site-1", sig)).toBe(true);
    expect(verifyUnsubscribe("site-2", sig)).toBe(false);
    expect(verifyUnsubscribe("site-1", "00" + (sig ?? "").slice(2))).toBe(false);
    expect(verifyUnsubscribe("site-1", null)).toBe(false);
    expect(verifyUnsubscribe(null, sig)).toBe(false);
  });

  it("one tap on the link switches the email off, with no sign-in, and says so in plain words", async () => {
    h.templates.set("a", { id: "a", name: "Mama Tee", organizationId: "org1" });
    const { GET } = await import("@/app/api/public/site-health/unsubscribe/route");
    const link = unsubscribeUrlFor("a");
    const res = await GET(new NextRequest(link));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("You&#39;re unsubscribed".replace("&#39;", "'"));
    expect(h.settings.get("a")?.digestOff).toBe(true);
    const bad = await GET(new NextRequest(link.replace(/sig=.{4}/, "sig=0000")));
    expect(bad.status).toBe(400);
  });

  it("does not move the 'fixes changed, check again' marker when only the email setting changes", () => {
    const src = readFileSync(new URL("../lib/db/opsEntities.ts", import.meta.url), "utf8");
    const watch = src.match(/updatedAt: \{ type: "string", default: \(\) => new Date\(\)\.toISOString\(\), watch: \[([^\]]+)\]/)?.[1] ?? "";
    expect(watch).toContain('"extras"');
    expect(watch).not.toMatch(/digest/i);
  });
});

describe("scheduling and the screens", () => {
  it("is scheduled once a day by the same scheduler as the other Site health jobs, and the route is locked and guarded", () => {
    const stack = readFileSync(new URL("../cdk/lib/published-sites-stack.ts", import.meta.url), "utf8");
    expect(stack).toContain('scheduledRoute("SiteHealthDigest", "/api/internal/site-health/digest", events.Schedule.cron({ minute: "0", hour: "8" }))');
    const route = readFileSync(new URL("../app/api/internal/site-health/digest/route.ts", import.meta.url), "utf8");
    expect(route).toContain("isCronRequest(request)");
    expect(route).toContain("takeJobLock");
  });

  it("the Site health tab has the switch, and the assistant has the same control", () => {
    const tab = readFileSync(new URL("../app/dashboard/_v3/hub/HealthTab.tsx", import.meta.url), "utf8");
    expect(tab).toContain("Weekly email");
    expect(tab).toContain("/health/digest");
    const mcp = readFileSync(new URL("../lib/mcp/healthTools.ts", import.meta.url), "utf8");
    expect(mcp).toContain('name: "set_site_health_email"');
  });
});
