import type { ElementPointer, Metric, Opportunity, Rating, SpeedReport } from "./types";

const PSI_URL = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

export function isPsiMock(): boolean {
  return process.env.SITE_HEALTH_MOCK === "1" || (!process.env.PAGESPEED_API_KEY && process.env.NODE_ENV !== "production");
}

export function isPsiConfigured(): boolean {
  return !!process.env.PAGESPEED_API_KEY || isPsiMock();
}

/**
 * Google's own "good / needs work / poor" cut-offs. tbt is Lighthouse's lab number (ms) that stands in for INP when
 * a site has no real-visitor data yet; its cut-offs are Lighthouse's.
 */
const LIMITS = { lcp: [2.5, 4], fcp: [1.8, 3], inp: [200, 500], cls: [0.1, 0.25], tbt: [200, 600] } as const;
export type MetricKind = keyof typeof LIMITS;

export function rate(kind: MetricKind, value: number): Rating {
  const [good, poor] = LIMITS[kind];
  return value <= good ? "good" : value <= poor ? "okay" : "poor";
}

export const METRIC_LIMITS = LIMITS;

const metric = (kind: MetricKind, value: number | null | undefined, source: "visitors" | "test", category?: string): Metric => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  // For real-visitor data Google's own FAST/AVERAGE/SLOW verdict wins over our arithmetic.
  const fromGoogle: Rating | null = category === "FAST" ? "good" : category === "AVERAGE" ? "okay" : category === "SLOW" ? "poor" : null;
  return { value, rating: fromGoogle ?? rate(kind, value), source };
};

type Audit = {
  score?: number | null;
  numericValue?: number;
  scoreDisplayMode?: string;
  details?: { overallSavingsMs?: number; overallSavingsBytes?: number; items?: { node?: { selector?: string; snippet?: string; nodeLabel?: string } }[] };
  metricSavings?: Record<string, number>;
};
type FieldMetric = { percentile?: number; category?: string };
type Experience = { metrics?: Record<string, FieldMetric>; origin_fallback?: boolean };
export type PsiJson = {
  lighthouseResult?: { categories?: Record<string, { score?: number | null }>; audits?: Record<string, Audit>; runtimeError?: { code?: string; message?: string } };
  loadingExperience?: Experience;
  originLoadingExperience?: Experience;
};

const pct = (n: number | null | undefined) => Math.round((n ?? 0) * 100);

/** Audits whose failing items we can point at on the page. */
const POINTABLE = ["heading-order", "link-name", "target-size", "color-contrast", "image-alt", "image-size-responsive", "unsized-images", "layout-shift-elements", "largest-contentful-paint-element", "label", "button-name", "document-title", "meta-viewport", "font-display"];
/** Audits that are about speed, to list savings. */
const SPEED_AUDITS = ["render-blocking-resources", "uses-optimized-images", "modern-image-formats", "uses-responsive-images", "offscreen-images", "unused-javascript", "unused-css-rules", "unminified-javascript", "unminified-css", "uses-text-compression", "server-response-time", "redirects", "uses-rel-preconnect", "font-display", "efficient-animated-content", "third-party-summary", "total-byte-weight", "dom-size", "unsized-images", "lcp-lazy-loaded", "prioritize-lcp-image", "bootup-time", "mainthread-work-breakdown"];

function pickField(json: PsiJson): { metrics: Record<string, FieldMetric>; scope: "page" | "site" } | null {
  const page = json.loadingExperience;
  // Google fills loadingExperience with the whole site's numbers when the page is too new; origin_fallback says so.
  if (page?.metrics && Object.keys(page.metrics).length && !page.origin_fallback) return { metrics: page.metrics, scope: "page" };
  const origin = json.originLoadingExperience ?? (page?.origin_fallback ? page : undefined);
  if (origin?.metrics && Object.keys(origin.metrics).length) return { metrics: origin.metrics, scope: "site" };
  return null;
}

/** Pure: turns Google's big answer into the small report we keep. */
export function parsePsi(json: PsiJson): SpeedReport {
  const lh = json.lighthouseResult;
  if (!lh?.categories) throw new PsiError("Google sent back an answer we could not read. Try again in a minute.", true);
  if (lh.runtimeError?.code && lh.runtimeError.code !== "NO_ERROR") throw new PsiError(explainRuntimeError(lh.runtimeError.code), isTemporaryRuntime(lh.runtimeError.code));
  const audits = lh.audits ?? {};
  const field = pickField(json);
  const f = field?.metrics ?? {};
  const lab = (id: string) => (typeof audits[id]?.numericValue === "number" ? audits[id].numericValue! : null);

  const fLcp = f.LARGEST_CONTENTFUL_PAINT_MS;
  const fFcp = f.FIRST_CONTENTFUL_PAINT_MS;
  const fInp = f.INTERACTION_TO_NEXT_PAINT;
  const fCls = f.CUMULATIVE_LAYOUT_SHIFT_SCORE;

  const labLcp = lab("largest-contentful-paint");
  const labFcp = lab("first-contentful-paint");
  const labCls = lab("cumulative-layout-shift");
  const tbt = lab("total-blocking-time");

  const inp = fInp?.percentile != null ? metric("inp", fInp.percentile, "visitors", fInp.category) : null;
  const failedAudits = Object.entries(audits)
    .filter(([, a]) => typeof a.score === "number" && a.score < 0.9 && a.scoreDisplayMode !== "informative" && a.scoreDisplayMode !== "notApplicable" && a.scoreDisplayMode !== "manual")
    .map(([id]) => id);

  const elements: Record<string, ElementPointer[]> = {};
  for (const id of POINTABLE) {
    const a = audits[id];
    if (!a || typeof a.score !== "number" || a.score >= 0.9) continue;
    const items = (a.details?.items ?? []).map((i) => i.node).filter((n): n is NonNullable<typeof n> => !!n?.selector);
    if (items.length) elements[id] = items.slice(0, 5).map((n) => ({ selector: n.selector!, snippet: (n.snippet ?? "").slice(0, 200), label: (n.nodeLabel ?? "").slice(0, 120) }));
  }

  const opportunities: Opportunity[] = [];
  for (const id of SPEED_AUDITS) {
    const a = audits[id];
    if (!a || typeof a.score !== "number" || a.score >= 0.9) continue;
    const ms = a.details?.overallSavingsMs ?? (typeof a.metricSavings?.LCP === "number" ? a.metricSavings.LCP : undefined);
    const bytes = a.details?.overallSavingsBytes;
    if ((ms ?? 0) > 0 || (bytes ?? 0) > 0) opportunities.push({ id, ...(ms ? { savingsMs: Math.round(ms) } : {}), ...(bytes ? { savingsBytes: Math.round(bytes) } : {}) });
  }
  opportunities.sort((a, b) => (b.savingsMs ?? 0) - (a.savingsMs ?? 0));

  return {
    speed: pct(lh.categories.performance?.score),
    seo: pct(lh.categories.seo?.score),
    accessibility: pct(lh.categories.accessibility?.score),
    bestPractices: pct(lh.categories["best-practices"]?.score),
    // Real visitors first; otherwise today's test run.
    lcp: fLcp?.percentile != null ? metric("lcp", fLcp.percentile / 1000, "visitors", fLcp.category) : metric("lcp", labLcp != null ? labLcp / 1000 : null, "test"),
    fcp: fFcp?.percentile != null ? metric("fcp", fFcp.percentile / 1000, "visitors", fFcp.category) : metric("fcp", labFcp != null ? labFcp / 1000 : null, "test"),
    inp,
    // PageSpeed reports the CLS percentile times 100 (a value of 5 means 0.05).
    cls: fCls?.percentile != null ? metric("cls", fCls.percentile / 100, "visitors", fCls.category) : metric("cls", labCls, "test"),
    tbt: metric("tbt", tbt, "test"),
    inpEstimated: inp == null && tbt != null,
    fieldScope: field?.scope ?? null,
    opportunities,
    elements,
    failedAudits,
    hasRealVisitorData: !!fLcp?.percentile || !!inp,
  };
}

/** A failure in plain words. `retryable` tells the caller whether another go may work. */
export class PsiError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
    readonly kind: "quota" | "busy" | "unreachable" | "timeout" | "too_new" | "key" | "other" = "other",
  ) {
    super(message);
  }
}

function isTemporaryRuntime(code: string): boolean {
  return /TIMEOUT|HUNG|INTERNAL|LIGHTHOUSE_TIMEOUT/i.test(code);
}

/** Lighthouse's error codes, said the way a person would. */
export function explainRuntimeError(code: string): string {
  if (/FAILED_DOCUMENT_REQUEST|ERRORED_DOCUMENT_REQUEST|DNS_FAILURE|INVALID_URL/i.test(code)) return "Google could not open your site. Check that it is published and loads in your own browser, then try again.";
  if (/NO_FCP|NO_LCP|NO_SPEEDLINE_FRAMES|SPEEDINDEX_OF_ZERO|NO_FMP/i.test(code)) return "Your page looked empty when Google opened it, so there was nothing to time. Add some text or a picture to the top of your page, publish, and try again.";
  if (/PAGE_HUNG|PROTOCOL_TIMEOUT|TIMEOUT/i.test(code)) return "Your page took too long to finish loading when Google tested it. Try again in a minute. If it keeps happening, your page may be very heavy.";
  if (/NOT_HTML/i.test(code)) return "That address isn't a web page Google can test.";
  return "Google's speed test could not finish this time. Try again in a few minutes.";
}

/** Pure: Google's HTTP failure into a plain sentence. Never includes the API key or raw error text. */
export function explainPsiFailure(status: number, body: { error?: { message?: string; errors?: { reason?: string }[]; status?: string } } | null): PsiError {
  const msg = body?.error?.message ?? "";
  const reason = body?.error?.errors?.[0]?.reason ?? body?.error?.status ?? "";
  if (status === 429 || /quota|rateLimit|RESOURCE_EXHAUSTED/i.test(`${msg} ${reason}`)) {
    return /per day|daily|dailyLimit/i.test(`${msg} ${reason}`)
      ? new PsiError("Plexo has used up its free speed tests for today. Your AI-visibility check still works, and the speed test will be back tomorrow.", false, "quota")
      : new PsiError("Google's speed test is busy right now. Try again in a few minutes.", true, "busy");
  }
  if (status === 403 || /API key|keyInvalid|PERMISSION_DENIED|forbidden/i.test(`${msg} ${reason}`)) return new PsiError("The speed test isn't set up correctly on our side. We've been told. Your other checks still work.", false, "key");
  if (/FAILED_DOCUMENT_REQUEST|ERRORED_DOCUMENT_REQUEST|DNS_FAILURE|INVALID_URL|UNABLE TO LOAD|could not (open|load|reach)/i.test(msg)) return new PsiError(explainRuntimeError("FAILED_DOCUMENT_REQUEST"), false, "unreachable");
  if (/NO_FCP|NO_LCP/i.test(msg)) return new PsiError(explainRuntimeError("NO_FCP"), false, "too_new");
  if (/TIMEOUT|HUNG|DEADLINE/i.test(`${msg} ${reason}`)) return new PsiError(explainRuntimeError("PAGE_HUNG"), true, "timeout");
  return new PsiError("The speed test could not run just now. Try again soon.", status >= 500);
}

async function once(url: string, strategy: "mobile" | "desktop"): Promise<SpeedReport> {
  const params = new URLSearchParams({ url, strategy });
  if (process.env.PAGESPEED_API_KEY) params.set("key", process.env.PAGESPEED_API_KEY);
  for (const c of ["performance", "seo", "accessibility", "best-practices"]) params.append("category", c);
  let res: Response;
  try {
    res = await fetch(`${PSI_URL}?${params.toString()}`, { signal: AbortSignal.timeout(50_000), cache: "no-store" });
  } catch {
    throw new PsiError("The speed test took too long. Try again in a minute.", true, "timeout");
  }
  if (!res.ok) throw explainPsiFailure(res.status, (await res.json().catch(() => null)) as never);
  return parsePsi((await res.json()) as PsiJson);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One run per phone/computer. A "busy" answer is retried once after a short wait; a daily-quota answer is not. */
export async function runPageSpeed(url: string, strategy: "mobile" | "desktop" = "mobile"): Promise<{ report: SpeedReport; sample: boolean }> {
  if (isPsiMock()) return { report: strategy === "desktop" ? mockSpeed(true) : mockSpeed(), sample: true };
  try {
    return { report: await once(url, strategy), sample: false };
  } catch (err) {
    if (err instanceof PsiError && err.kind === "busy") {
      await sleep(3000 + Math.floor(Math.random() * 2000));
      return { report: await once(url, strategy), sample: false };
    }
    throw err;
  }
}

export function mockSpeed(desktop = false): SpeedReport {
  return {
    speed: desktop ? 91 : 72,
    seo: 92,
    accessibility: 88,
    bestPractices: 96,
    lcp: metric("lcp", desktop ? 1.4 : 3.1, "test"),
    inp: null,
    cls: metric("cls", 0.04, "test"),
    fcp: metric("fcp", desktop ? 0.8 : 1.6, "test"),
    tbt: metric("tbt", desktop ? 40 : 310, "test"),
    inpEstimated: true,
    fieldScope: null,
    opportunities: [
      { id: "uses-optimized-images", savingsMs: 900, savingsBytes: 420_000 },
      { id: "render-blocking-resources", savingsMs: 450 },
      { id: "offscreen-images", savingsMs: 300 },
    ],
    elements: { "image-alt": [{ selector: "body > section.hero > img", snippet: '<img src="/hero.jpg">', label: "Picture at the top of the page" }] },
    failedAudits: ["uses-optimized-images", "offscreen-images", "unused-javascript", "image-alt", "render-blocking-resources"],
    hasRealVisitorData: false,
  };
}
