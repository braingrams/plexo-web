/** What the owner sees. Google's own words (sessions, active users, channel groups) never reach this shape. */

export type RangeDays = 7 | 28 | 90;

export type Totals = {
  /** Different people who visited. */
  visitors: number;
  /** Times people came to the site (one person can visit several times). */
  visits: number;
  /** Pages looked at. */
  pageViews: number;
  /** Average time people stayed, in seconds. */
  avgSeconds: number;
  /** Share of visits where the person actually looked around (0 to 1). */
  engagedShare: number;
};

export type Ranked = { name: string; value: number };
export type TopPage = { path: string; title: string; views: number };
export type DayPoint = { date: string; visitors: number; pageViews: number };

export type AnalyticsReport = {
  rangeDays: RangeDays;
  totals: Totals;
  /** The same totals for the period just before, for "up 12%" comparisons. */
  previous: Totals;
  daily: DayPoint[];
  topPages: TopPage[];
  /** Where people came from, in plain words (Search, Social, Direct, Other websites, Email…). */
  sources: Ranked[];
  countries: Ranked[];
  /** Phone, Computer, Tablet. */
  devices: Ranked[];
};

/** Everything the dashboard needs from Google. Real and sample implementations both sit behind it. */
export interface AnalyticsDataClient {
  getReport(propertyName: string, rangeDays: RangeDays): Promise<AnalyticsReport>;
}
