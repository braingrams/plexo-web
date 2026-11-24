import { createHmac, timingSafeEqual } from "node:crypto";
import { PublishedDomain, Template } from "@/lib/db/contentEntities";
import { User } from "@/lib/db/coreEntities";
import { SiteHealthSettings } from "@/lib/db/opsEntities";
import { sendMaildripEmail } from "@/lib/mail/maildrip";
import { buildSiteHealthDigestEmail, type DigestEmailInput } from "@/lib/mail/templates";
import { buildIssues, headline } from "./explain";
import { forgetHealthSettings } from "./serve";
import { loadHealthStatus } from "./service";
import type { HealthReport } from "./types";

/**
 * The weekly "Your site health" email. Plain words, no jargon: how the site is doing, what changed since the last email, the three
 * things worth fixing first, and one button that opens Site health. On unless the owner switched it off (Site health tab, or the
 * link at the bottom of the email, which works without signing in). It only ever reports a check that already exists (the weekly
 * automatic check, or one the owner ran): sending the email never runs a speed test, so it costs nothing in Google allowance.
 */

const APP_URL = () => (process.env.NEXT_PUBLIC_APP_URL?.startsWith("http") ? process.env.NEXT_PUBLIC_APP_URL : "https://plexo.charisol.io").replace(/\/$/, "");
/** An email is sent at most this often per site, even if the job runs twice. */
export const DIGEST_MIN_GAP_MS = 6 * 24 * 60 * 60 * 1000;
/** A check older than this is not reported: the numbers would be stale, and the weekly check will have refreshed them soon. */
export const DIGEST_MAX_CHECK_AGE_MS = 9 * 24 * 60 * 60 * 1000;

export type DigestScores = { speed: number | null; computer: number | null; search: number | null; ai: number | null };

export const scoresOf = (r: HealthReport): DigestScores => ({ speed: r.speed?.speed ?? null, computer: r.desktop?.speed ?? null, search: r.speed?.seo ?? null, ai: r.aeo?.score ?? null });

const LABELS: Record<keyof DigestScores, string> = { speed: "Speed on phones", computer: "Speed on computers", search: "Findable in search", ai: "Findable by AI assistants" };

/** Pure: each score with how it moved since the last email (null = nothing to compare with, or the score is missing). */
export function scoreChanges(now: DigestScores, before: DigestScores | null): { label: string; score: number; change: number | null }[] {
  return (Object.keys(LABELS) as (keyof DigestScores)[])
    .filter((k) => now[k] != null)
    .map((k) => ({ label: LABELS[k], score: now[k] as number, change: before && before[k] != null ? (now[k] as number) - (before[k] as number) : null }));
}

/** Pure: what the email says, from a finished check. Null when there is nothing to say (no check yet). */
export function composeDigest(input: { siteName: string; siteId: string; report: HealthReport; settings: Parameters<typeof buildIssues>[0]["settings"]; before: DigestScores | null; facts?: { productCount: number }; unsubscribeUrl: string }): DigestEmailInput {
  const issues = buildIssues({ speed: input.report.speed, aeo: input.report.aeo, settings: input.settings, facts: input.facts }).filter((i) => i.severity !== "good");
  const head = headline(input.report);
  return {
    siteName: input.siteName,
    headline: head.text,
    scores: scoreChanges(scoresOf(input.report), input.before),
    fixes: issues.slice(0, 3).map((i) => ({ title: i.title, why: i.why, gain: i.gain, canFixForYou: !!i.autoFix && !i.autoFix.on })),
    moreCount: Math.max(0, issues.length - 3),
    openUrl: `${APP_URL()}/dashboard/sites/${input.siteId}?tab=health`,
    unsubscribeUrl: input.unsubscribeUrl,
  };
}

// ── The unsubscribe link: signed, so it works without signing in and cannot be made up for someone else's site ──

function tokenKey(): string {
  const base = process.env.AUTH_SECRET;
  if (!base) throw new Error("AUTH_SECRET is not configured.");
  return createHmac("sha256", base).update("plexo:site-health-digest:v1").digest("hex");
}
const sign = (siteId: string) => createHmac("sha256", tokenKey()).update(`unsubscribe\n${siteId}`).digest("hex");

export function unsubscribeUrlFor(siteId: string): string {
  return `${APP_URL()}/api/public/site-health/unsubscribe?site=${encodeURIComponent(siteId)}&sig=${sign(siteId)}`;
}

export function verifyUnsubscribe(siteId: string | null, sig: string | null): boolean {
  if (!siteId || !sig) return false;
  try {
    const a = Buffer.from(sign(siteId), "hex");
    const b = Buffer.from(sig, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** Switches the weekly email on or off for one site. */
export async function setDigestEnabled(site: { id: string; organizationId: string }, enabled: boolean): Promise<void> {
  await SiteHealthSettings.upsert({ templateId: site.id, organizationId: site.organizationId, digestOff: !enabled }).go();
  forgetHealthSettings(site.id);
}

export type DigestSummary = { looked: number; sent: number; skipped: number; failed: number; /** Why nothing was done, when the whole run was refused. */ reason?: string };

/**
 * The email goes to real owners through the mail service, so only the production app may send it. Staging and previews share the same
 * mail keys and have real-looking sites in their own data, and must never mail anyone. PLEXO_ENV is set on every deployed app
 * ("production" or "staging"); it is unset in local development, which also sends nothing.
 */
export const digestsAllowedHere = (): boolean => process.env.PLEXO_ENV === "production";

/** Pure: should this site get an email now? */
export function digestDue(input: { enabled: boolean; lastCheckAt: string | null; lastSentAt: string | null; now: number }): boolean {
  if (!input.enabled || !input.lastCheckAt) return false;
  if (input.now - new Date(input.lastCheckAt).getTime() > DIGEST_MAX_CHECK_AGE_MS) return false;
  if (input.lastSentAt && input.now - new Date(input.lastSentAt).getTime() < DIGEST_MIN_GAP_MS) return false;
  return true;
}

/** Live sites (one per address list), found the way the weekly sweep finds them. */
async function liveSiteIds(): Promise<string[]> {
  const ids = new Set<string>();
  let cursor: string | null = null;
  for (;;) {
    const page: { data: { templateId: string; active?: boolean; planDisabledAt?: string }[]; cursor: string | null } = await PublishedDomain.scan.where(({ active }, { eq }) => eq(active, true)).go({ cursor });
    for (const d of page.data) if (!d.planDisabledAt) ids.add(d.templateId);
    cursor = page.cursor;
    if (!cursor) break;
  }
  return [...ids];
}

/** Sends this week's email to every owner who has it on, within a time budget. Safe to run twice: a site is emailed at most once a week. */
export async function sendWeeklyDigests(opts: { now?: number; budgetMs?: number; max?: number } = {}): Promise<DigestSummary> {
  const started = Date.now();
  const now = opts.now ?? Date.now();
  const budget = opts.budgetMs ?? 45_000;
  const max = opts.max ?? Number(process.env.SITE_HEALTH_DIGESTS_PER_RUN ?? 200);
  const summary: DigestSummary = { looked: 0, sent: 0, skipped: 0, failed: 0 };
  if (!digestsAllowedHere()) return { ...summary, reason: "The weekly site health email is only sent from production." };
  for (const id of await liveSiteIds()) {
    if (summary.sent >= max || Date.now() - started > budget) break;
    summary.looked++;
    try {
      const [row, { data: site }] = await Promise.all([SiteHealthSettings.get({ templateId: id }).go().then((r) => r.data), Template.get({ id }).go()]);
      if (!site || site.parentId || site.kind !== "LANDING_PAGE") { summary.skipped++; continue; }
      const status = await loadHealthStatus(id);
      if (!status.last || !digestDue({ enabled: !row?.digestOff, lastCheckAt: status.last.createdAt, lastSentAt: row?.digestSentAt ?? null, now })) { summary.skipped++; continue; }
      const { data: owner } = await User.get({ id: site.userId }).go();
      if (!owner?.email) { summary.skipped++; continue; }
      const mail = composeDigest({ siteName: site.name, siteId: id, report: status.last.report, settings: status.settings, before: (row?.digestScores as DigestScores | undefined) ?? null, facts: status.facts, unsubscribeUrl: unsubscribeUrlFor(id) });
      const { subject, html } = buildSiteHealthDigestEmail(mail);
      await sendMaildripEmail({ to: owner.email, subject, html });
      await SiteHealthSettings.upsert({ templateId: id, organizationId: site.organizationId, digestSentAt: new Date(now).toISOString(), digestScores: scoresOf(status.last.report) }).go();
      summary.sent++;
    } catch (err) {
      summary.failed++;
      console.error("site health: weekly email failed:", err instanceof Error ? err.message : "unknown error");
    }
  }
  return summary;
}
