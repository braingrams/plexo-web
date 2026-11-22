import type { AnalyticsReport } from "./types";

export type Insight = { tone: "good" | "note" | "tip"; text: string };

const pct = (cur: number, prev: number): number | null => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null);
const share = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

function duration(seconds: number): string {
  if (seconds < 60) return `${seconds} seconds`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m} min ${s} sec` : `${m} min`;
}

/** Plain-language takeaways from a report. Never more than five, most important first. */
export function buildInsights(r: AnalyticsReport): Insight[] {
  const out: Insight[] = [];
  const period = r.rangeDays === 7 ? "week" : `${r.rangeDays} days`;
  if (r.totals.visitors === 0) {
    return [{ tone: "tip", text: "Nobody has visited yet. Share your web address with a few friends or on social media, and they will show up here within a day." }];
  }

  const change = pct(r.totals.visitors, r.previous.visitors);
  if (change !== null && Math.abs(change) >= 5) {
    out.push(change > 0
      ? { tone: "good", text: `More people found you: ${r.totals.visitors} visitors, up ${change}% on the ${period === "week" ? "week" : "period"} before.` }
      : { tone: "note", text: `Fewer people visited: ${r.totals.visitors}, down ${Math.abs(change)}% on the ${period === "week" ? "week" : "period"} before. Sharing a link or posting something new usually helps.` });
  } else {
    out.push({ tone: "note", text: `${r.totals.visitors} ${r.totals.visitors === 1 ? "person" : "people"} visited in the last ${period}, about the same as before.` });
  }

  const best = r.daily.reduce((b, d) => (d.visitors > b.visitors ? d : b), r.daily[0]);
  if (best && best.visitors > 0 && r.daily.length > 3) {
    const day = new Date(`${best.date}T12:00:00Z`).toLocaleDateString("en", { weekday: "long", month: "short", day: "numeric" });
    out.push({ tone: "note", text: `${day} was your busiest day, with ${best.visitors} visitors.` });
  }

  const top = r.topPages[0];
  if (top && r.totals.pageViews > 0) {
    const label = top.path === "/" ? "your home page" : top.title || top.path;
    out.push({ tone: "note", text: `${label.charAt(0).toUpperCase()}${label.slice(1)} is your most popular page (${share(top.views, r.totals.pageViews)}% of all views).` });
  }

  const source = r.sources[0];
  const sourceTotal = r.sources.reduce((s, x) => s + x.value, 0);
  if (source) out.push({ tone: "note", text: `Most people came from: ${source.name.charAt(0).toLowerCase()}${source.name.slice(1)} (${share(source.value, sourceTotal)}%).` });

  const phone = r.devices.find((d) => d.name === "Phone");
  const deviceTotal = r.devices.reduce((s, x) => s + x.value, 0);
  if (phone && share(phone.value, deviceTotal) >= 60) {
    out.push({ tone: "tip", text: `${share(phone.value, deviceTotal)}% of visitors use a phone, so check your site looks great on a small screen.` });
  } else if (r.totals.avgSeconds > 0) {
    out.push({ tone: r.totals.avgSeconds >= 60 ? "good" : "tip", text: `People stay about ${duration(r.totals.avgSeconds)} on your site.` });
  }
  return out.slice(0, 5);
}
