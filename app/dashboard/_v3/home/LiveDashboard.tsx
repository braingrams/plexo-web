"use client";

import Link from "next/link";
import type { SiteSummary } from "@/lib/dashboardV3/sites";
import type { SiteStats } from "@/lib/dashboardV3/homeData";
import { dayLabels } from "@/lib/dashboardV3/visitsTrend";
import { Badge, Card, CardHeader, EmptyState } from "../ui";
import { timeAgo } from "./api";
import { seeAllHref } from "@/lib/dashboardV3/seeAllLinks";
import type { Experience } from "@/lib/dashboardV3/nav";

export function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span className="plx-small" style={{ fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.1 }}>{value}</span>
      {hint ? <span className="plx-small">{hint}</span> : null}
    </Card>
  );
}

export function StatGrid({ stats }: { stats: SiteStats["stats"] }) {
  return (
    <div data-tour="home-stats" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 200px), 1fr))", gap: 16 }}>
      {stats.map((s) => (
        <StatTile key={s.id} label={s.label} value={s.value} hint={s.hint} />
      ))}
    </div>
  );
}

export function ActivityCard({ stats, site, experience }: { stats: SiteStats; site: SiteSummary; experience?: Experience }) {
  const seeAll = seeAllHref(stats.activityKind ?? "none", site.id, experience);
  return (
    <Card padding="lg">
      <CardHeader title={stats.activityTitle} action={stats.activity.length && seeAll ? <Link href={seeAll} className="plx-small" style={{ color: "var(--plx-link)", fontWeight: 700 }}>See all</Link> : undefined} />
      {stats.activity.length ? (
        <ul style={{ listStyle: "none", margin: "12px 0 0", padding: 0, display: "flex", flexDirection: "column" }}>
          {stats.activity.map((a) => (
            <li key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "12px 0", borderTop: "1px solid var(--plx-border)", minHeight: 44 }}>
              <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <span style={{ fontWeight: 700, overflowWrap: "anywhere" }}>{a.who}</span>
                <span className="plx-small">{timeAgo(a.when)}</span>
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                {a.amount ? <span style={{ fontWeight: 700 }}>{a.amount}</span> : null}
                {a.amount ? <Badge tone={a.paid ? "success" : "warning"}>{a.paid ? "Paid" : "Waiting"}</Badge> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState compact title="Nothing here yet" body={stats.activityEmpty} />
      )}
    </Card>
  );
}

/** A calm seven-day bar chart of visits, with a friendly empty state when nobody has visited yet. */
export function VisitsCard({ days, now }: { days: number[]; now?: number }) {
  const total = days.reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...days);
  const labels = dayLabels(now);
  return (
    <Card padding="lg" data-tour="home-visits">
      <CardHeader title="Visits this week" description={total ? `${total.toLocaleString("en")} visit${total === 1 ? "" : "s"} in the last 7 days` : undefined} />
      {total ? (
        <div className="plx-trend" role="img" aria-label={`Visits per day: ${days.map((n, i) => `${labels[i]} ${n}`).join(", ")}`}>
          {days.map((n, i) => (
            <div key={i} className="plx-trend__col">
              <span className="plx-trend__n">{n}</span>
              <span className="plx-trend__plot">
                <span className="plx-trend__bar" style={{ height: `${Math.max(3, Math.round((n / max) * 100))}%` }} data-today={i === days.length - 1 ? "true" : undefined} />
              </span>
              <span className="plx-trend__day">{labels[i]}</span>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState compact title="No visits yet" body="Share your link and the first visitors will show up here, day by day." />
      )}
    </Card>
  );
}
