import type { AnalyticsDataClient, AnalyticsReport, DayPoint, Ranked, RangeDays, Totals, TopPage } from "./types";

const DATA_API = "https://analyticsdata.googleapis.com/v1beta";

export class GoogleApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
  /** Permission was taken back, or the property was deleted in Google. */
  get needsReconnect(): boolean {
    return this.status === 401 || this.status === 403 || this.status === 404;
  }
}

type Row = { dimensionValues?: { value: string }[]; metricValues?: { value: string }[] };
type RunReport = { rows?: Row[] };

const num = (r: Row | undefined, i: number) => Number(r?.metricValues?.[i]?.value ?? 0) || 0;
const dim = (r: Row, i = 0) => r.dimensionValues?.[i]?.value ?? "";

const CHANNEL_WORDS: Record<string, string> = {
  "Organic Search": "Google and other search",
  "Paid Search": "Paid search ads",
  Direct: "Typed your address or a bookmark",
  "Organic Social": "Social media",
  "Paid Social": "Social media ads",
  Referral: "Links on other websites",
  Email: "Email",
  "Organic Video": "Videos",
  Display: "Banner ads",
  Unassigned: "Somewhere we could not tell",
};
const DEVICE_WORDS: Record<string, string> = { mobile: "Phone", desktop: "Computer", tablet: "Tablet" };

const dateStr = (d: Date) => d.toISOString().slice(0, 10);
function rangeFor(days: number, offsetDays = 0) {
  const end = new Date(Date.now() - (offsetDays + 1) * 86400000); // today is unfinished, so end yesterday
  const start = new Date(end.getTime() - (days - 1) * 86400000);
  return { startDate: dateStr(start), endDate: dateStr(end) };
}

function totalsFrom(r: Row | undefined): Totals {
  // metrics order: activeUsers, sessions, screenPageViews, averageSessionDuration, engagementRate
  return { visitors: num(r, 0), visits: num(r, 1), pageViews: num(r, 2), avgSeconds: Math.round(num(r, 3)), engagedShare: num(r, 4) };
}

function ranked(rows: Row[] | undefined, words?: Record<string, string>, limit = 6): Ranked[] {
  return (rows ?? [])
    .map((r) => ({ name: words?.[dim(r)] ?? (dim(r) || "Unknown"), value: num(r, 0) }))
    .filter((r) => r.value > 0)
    .slice(0, limit);
}

const METRICS = ["activeUsers", "sessions", "screenPageViews", "averageSessionDuration", "engagementRate"].map((name) => ({ name }));

/** The real thing: Google Analytics Data API, called with a short-lived access token that the caller just refreshed. */
export class GoogleAnalyticsDataClient implements AnalyticsDataClient {
  constructor(private readonly accessToken: string) {}

  private async batch(property: string, requests: unknown[]): Promise<RunReport[]> {
    const res = await fetch(`${DATA_API}/${property}:batchRunReports`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ requests }),
      cache: "no-store",
    });
    if (!res.ok) throw new GoogleApiError(res.status, `Google Analytics answered ${res.status}`);
    return ((await res.json()) as { reports?: RunReport[] }).reports ?? [];
  }

  async getReport(property: string, rangeDays: RangeDays): Promise<AnalyticsReport> {
    const cur = rangeFor(rangeDays);
    const prev = rangeFor(rangeDays, rangeDays);
    const [first, second] = await Promise.all([
      this.batch(property, [
        { dateRanges: [cur, prev], metrics: METRICS },
        { dateRanges: [cur], dimensions: [{ name: "date" }], metrics: [{ name: "activeUsers" }, { name: "screenPageViews" }], orderBys: [{ dimension: { dimensionName: "date" } }] },
        { dateRanges: [cur], dimensions: [{ name: "pagePath" }, { name: "pageTitle" }], metrics: [{ name: "screenPageViews" }], orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }], limit: 8 },
      ]),
      this.batch(property, [
        { dateRanges: [cur], dimensions: [{ name: "sessionDefaultChannelGroup" }], metrics: [{ name: "sessions" }], orderBys: [{ metric: { metricName: "sessions" }, desc: true }], limit: 8 },
        { dateRanges: [cur], dimensions: [{ name: "country" }], metrics: [{ name: "activeUsers" }], orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }], limit: 8 },
        { dateRanges: [cur], dimensions: [{ name: "deviceCategory" }], metrics: [{ name: "activeUsers" }], orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }] },
      ]),
    ]);
    // With two date ranges Google adds a "dateRange" dimension: date_range_0 is the current period.
    const totalRows = first[0]?.rows ?? [];
    const curRow = totalRows.find((r) => dim(r) === "date_range_0") ?? (totalRows.length === 1 ? totalRows[0] : undefined);
    const prevRow = totalRows.find((r) => dim(r) === "date_range_1");
    const daily: DayPoint[] = (first[1]?.rows ?? []).map((r) => ({
      date: `${dim(r).slice(0, 4)}-${dim(r).slice(4, 6)}-${dim(r).slice(6, 8)}`,
      visitors: num(r, 0),
      pageViews: num(r, 1),
    }));
    const topPages: TopPage[] = (first[2]?.rows ?? []).map((r) => ({ path: dim(r, 0), title: dim(r, 1), views: num(r, 0) })).filter((p) => p.views > 0);
    return {
      rangeDays,
      totals: totalsFrom(curRow),
      previous: totalsFrom(prevRow),
      daily,
      topPages,
      sources: ranked(second[0]?.rows, CHANNEL_WORDS),
      countries: ranked(second[1]?.rows),
      devices: ranked(second[2]?.rows, DEVICE_WORDS),
    };
  }
}

/** Sample numbers for dev and previews (GOOGLE_ANALYTICS_MOCK=1, or no Google credentials outside production). */
export class MockAnalyticsDataClient implements AnalyticsDataClient {
  async getReport(_property: string, rangeDays: RangeDays): Promise<AnalyticsReport> {
    const daily: DayPoint[] = [];
    for (let i = rangeDays - 1; i >= 0; i--) {
      const d = new Date(Date.now() - (i + 1) * 86400000);
      const wave = 1 + Math.sin(i / 2.2) * 0.35 + (rangeDays - i) / (rangeDays * 4);
      daily.push({ date: dateStr(d), visitors: Math.round(26 * wave), pageViews: Math.round(61 * wave) });
    }
    const sum = (k: "visitors" | "pageViews") => daily.reduce((s, d) => s + d[k], 0);
    const totals: Totals = { visitors: sum("visitors"), visits: Math.round(sum("visitors") * 1.3), pageViews: sum("pageViews"), avgSeconds: 94, engagedShare: 0.61 };
    const previous: Totals = { visitors: Math.round(totals.visitors * 0.86), visits: Math.round(totals.visits * 0.88), pageViews: Math.round(totals.pageViews * 0.9), avgSeconds: 81, engagedShare: 0.55 };
    return {
      rangeDays,
      totals,
      previous,
      daily,
      topPages: [
        { path: "/", title: "Home", views: Math.round(totals.pageViews * 0.42) },
        { path: "/about", title: "About us", views: Math.round(totals.pageViews * 0.18) },
        { path: "/store", title: "Shop", views: Math.round(totals.pageViews * 0.15) },
        { path: "/contact", title: "Contact", views: Math.round(totals.pageViews * 0.09) },
      ],
      sources: [
        { name: "Google and other search", value: Math.round(totals.visits * 0.46) },
        { name: "Social media", value: Math.round(totals.visits * 0.27) },
        { name: "Typed your address or a bookmark", value: Math.round(totals.visits * 0.2) },
        { name: "Links on other websites", value: Math.round(totals.visits * 0.07) },
      ],
      countries: [
        { name: "Nigeria", value: Math.round(totals.visitors * 0.58) },
        { name: "United States", value: Math.round(totals.visitors * 0.17) },
        { name: "United Kingdom", value: Math.round(totals.visitors * 0.11) },
        { name: "Ghana", value: Math.round(totals.visitors * 0.05) },
      ],
      devices: [
        { name: "Phone", value: Math.round(totals.visitors * 0.72) },
        { name: "Computer", value: Math.round(totals.visitors * 0.25) },
        { name: "Tablet", value: Math.round(totals.visitors * 0.03) },
      ],
    };
  }
}
