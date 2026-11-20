import { SiteHealthCheck, SiteHealthRecheck, SiteHealthSettings } from "@/lib/db/opsEntities";
import { PublishedDomain, Template } from "@/lib/db/contentEntities";
import { checkCommerceRateLimit } from "@/lib/commerceRateLimitDynamo";
import { runAeo } from "./aeo";
import { isPsiMock, PsiError, runPageSpeed } from "./psi";
import { toView } from "./serve";
import { siteFacts } from "./facts";
import { autoStatus, WEEKLY_MS } from "./service-status";

export { WEEKLY_MS };
import type { HealthReport, HealthStatus } from "./types";

/** The address visitors use, and when the live site last changed (published or edited). */
async function liveInfo(siteId: string): Promise<{ url: string | null; changedAt: string | null }> {
  const [{ data: domains }, { data: tpl }] = await Promise.all([PublishedDomain.query.primary({ templateId: siteId }).go({ pages: "all" }), Template.get({ id: siteId }).go()]);
  const live = domains.filter((d) => d.active !== false);
  const best = live.find((d) => d.type === "CUSTOM") ?? live[0];
  const stamps = [...live.map((d) => d.updatedAt), tpl?.updatedAt].filter((v): v is string => typeof v === "string");
  return { url: best ? `https://${best.domain}` : null, changedAt: stamps.sort().pop() ?? null };
}


/** A site can be re-checked this often (and a check is remembered for this long). */
export const CHECK_COOLDOWN_MS = 5 * 60 * 1000;
/** After the owner publishes or switches a fix on, a fresh look is wanted sooner. */
export const CHANGED_COOLDOWN_MS = 60 * 1000;
/** Each check costs two Google speed tests (phone and computer). Google's free allowance is 25,000 a day with a key. */
const DAILY_CHECKS = Number(process.env.SITE_HEALTH_DAILY_CHECKS ?? 3200);
/** Automatic re-checks have their own daily allowance, so they can never use up the tests owners press for themselves. 3,200 + 4,800 checks = 16,000 Google calls, under the 25,000 free daily allowance. */
const SCHEDULED_DAILY_CHECKS = Number(process.env.SITE_HEALTH_SCHEDULED_DAILY ?? 4800);
/** An owner whose sites keep changing cannot cost more than this many automatic checks a day. */
const SCHEDULED_PER_ORG_DAY = 40;

const HISTORY_LIMIT = 20;
const ORG_PER_HOUR = 12;

export async function loadHealthStatus(siteId: string): Promise<HealthStatus> {
  const [info, settingsRow, recent, facts, queued] = await Promise.all([
    liveInfo(siteId),
    SiteHealthSettings.get({ templateId: siteId }).go().then((r) => r.data),
    SiteHealthCheck.query.primary({ templateId: siteId }).go({ order: "desc", limit: HISTORY_LIMIT }),
    siteFacts(siteId),
    SiteHealthRecheck.get({ templateId: siteId }).go().then((r) => r.data).catch(() => null),
  ]);
  const settings = toView(settingsRow);
  const rows = recent.data;
  const latest = rows[0];
  const stale = !!latest && !!info.changedAt && info.changedAt > latest.createdAt;
  const fixesChangedSinceCheck = !!latest && !!settingsRow?.updatedAt && settingsRow.updatedAt > latest.createdAt;
  const nextAt = latest ? new Date(latest.createdAt).getTime() + (stale || fixesChangedSinceCheck ? CHANGED_COOLDOWN_MS : CHECK_COOLDOWN_MS) : 0;
  return {
    siteId,
    url: info.url,
    stale,
    fixesChangedSinceCheck,
    last: latest ? { createdAt: latest.createdAt, report: latest.report as HealthReport } : null,
    history: rows.map((r) => ({ createdAt: r.createdAt, speed: r.speedScore ?? null, aeo: r.aeoScore ?? null, desktop: (r.report as HealthReport | undefined)?.desktop?.speed ?? null })).reverse(),
    nextCheckAt: nextAt > Date.now() ? new Date(nextAt).toISOString() : null,
    settings,
    facts,
    auto: autoStatus(rows, queued),
  };
}


export type RunOutcome = { ok: true; status: HealthStatus; cached: boolean } | { ok: false; error: string; status?: number };

export const fixesOnList = (st: HealthStatus["settings"]): string[] => [
  ...(st.fallbackDescription ? ["meta_description"] : []),
  ...(st.llmsTxt ? ["llms_txt"] : []),
  ...(st.organizationSchema ? ["organization_schema"] : []),
  ...(st.lazyEmbeds ? ["lazy_embeds"] : []),
  ...(st.altFromFilename ? ["alt_text"] : []),
  ...(st.language ? ["language"] : []),
  ...Object.keys(st.extras),
];

const reasonOf = (r: PromiseRejectedResult, what: string) => {
  if (r.reason instanceof PsiError) return r.reason.message;
  console.error(`site health: ${what} failed:`, r.reason instanceof Error ? r.reason.message : "unknown error");
  return "The speed test could not run just now. Try again soon.";
};

/** Runs the speed test (phone and computer) and the AI-visibility check on the published address, then keeps the result. */
export async function runSiteCheck(site: { id: string; organizationId: string }, opts: { scheduled?: "changed" | "weekly" } = {}): Promise<RunOutcome> {
  const scheduled = opts.scheduled;
  const before = await loadHealthStatus(site.id);
  const url = before.url;
  if (!url) return { ok: false, status: 409, error: "Your site isn't live yet. Publish it first, then we can check how fast it is." };
  if (before.nextCheckAt && before.last) return { ok: true, status: before, cached: true };
  // A check by the owner (or a newer one) already covers the change: nothing to do.
  if (scheduled === "changed" && before.last && !before.stale && !before.fixesChangedSinceCheck) return { ok: true, status: before, cached: true };

  const freshWindow = before.stale || before.fixesChangedSinceCheck ? CHANGED_COOLDOWN_MS : CHECK_COOLDOWN_MS;
  // Automatic checks use their own keys: they never spend the owner's hourly allowance, and the owner's allowance never blocks them.
  const allowed = scheduled
    ? (await checkCommerceRateLimit(`sitehealth:site:${site.id}`, 1, freshWindow)) && (await checkCommerceRateLimit(`sitehealth:orgauto:${site.organizationId}`, SCHEDULED_PER_ORG_DAY, 24 * 60 * 60 * 1000))
    : (await checkCommerceRateLimit(`sitehealth:site:${site.id}`, 1, freshWindow)) && (await checkCommerceRateLimit(`sitehealth:org:${site.organizationId}`, ORG_PER_HOUR, 60 * 60 * 1000));
  if (!allowed) return { ok: false, status: 429, error: scheduled ? "Automatic check limit reached for this account today." : "You've run a lot of checks. Please wait a few minutes and try again." };
  // One shared allowance for everyone: stops a busy day from using up Google's free tests.
  const budgetOk = isPsiMock() || (await checkCommerceRateLimit(scheduled ? "sitehealth:global:auto" : "sitehealth:global", scheduled ? SCHEDULED_DAILY_CHECKS : DAILY_CHECKS, 24 * 60 * 60 * 1000));
  const testUrl = before.last && (before.stale || before.fixesChangedSinceCheck) ? `${url}/?plexo-check=${Date.now()}` : url;

  const [phone, computer, aeo] = await Promise.allSettled([budgetOk ? runPageSpeed(testUrl, "mobile") : Promise.reject(new PsiError("Plexo has used up its free speed tests for today. Your AI-visibility check still works, and the speed test will be back tomorrow.", false, "quota")), budgetOk ? runPageSpeed(testUrl, "desktop") : Promise.reject(new PsiError("", false, "quota")), runAeo(testUrl)]);
  const report: HealthReport = { url, speed: null, aeo: null, fixesOn: fixesOnList(before.settings), ...(scheduled ? { auto: scheduled } : {}) };
  if (phone.status === "fulfilled") {
    report.speed = phone.value.report;
    if (phone.value.sample) report.sample = true;
  } else report.speedError = reasonOf(phone, "speed test");
  if (computer.status === "fulfilled") report.desktop = computer.value.report;
  if (aeo.status === "fulfilled") report.aeo = aeo.value;
  else report.aeoError = aeo.reason instanceof Error ? aeo.reason.message : "We could not read your page.";

  if (!report.speed && !report.aeo) return { ok: false, status: 502, error: report.speedError ?? report.aeoError ?? "The check could not run. Try again soon." };

  await SiteHealthCheck.create({ templateId: site.id, createdAt: new Date().toISOString(), url, report, speedScore: report.speed?.speed, aeoScore: report.aeo?.score }).go();
  // A check ran, so a waiting re-check (queued by a change) is no longer needed.
  await SiteHealthRecheck.delete({ templateId: site.id }).go().catch(() => undefined);
  return { ok: true, status: await loadHealthStatus(site.id), cached: false };
}
