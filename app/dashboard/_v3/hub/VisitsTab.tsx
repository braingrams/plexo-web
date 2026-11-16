"use client";

import { Card, CardHeader } from "../ui";
import type { HubVisits } from "@/lib/dashboardV3/hubData";
import { TabBar } from "./HubFrame";

export function VisitsTab({ visits }: { visits: HubVisits }) {
  const max = Math.max(1, ...visits.days.map((d) => d.views));
  const last7 = visits.days.slice(-7).reduce((s, d) => s + d.views, 0);
  const best = visits.days.reduce((b, d) => (d.views > b.views ? d : b), visits.days[0] ?? { label: "", views: 0 });
  return (
    <>
      <TabBar title="Your visits" sub="How many times people looked at your site over the last two weeks." />
      <div className="plx-stats" data-tour="hub-visits">
        <Card className="plx-stat"><b>{visits.total}</b><span>visits in 14 days</span></Card>
        <Card className="plx-stat"><b>{last7}</b><span>visits this week</span></Card>
        <Card className="plx-stat"><b>{best.views}</b><span>{best.views ? `on your busiest day (${best.label})` : "on your busiest day"}</span></Card>
      </div>
      <Card>
        <CardHeader title="Day by day" />
        {visits.total === 0 ? <p className="plx-body" style={{ marginBottom: 16 }}>No visits yet. Share your web address and they will start to appear here.</p> : null}
        <div className="plx-bars" role="img" aria-label={`Visits per day, ${visits.total} in total`}>
          {visits.days.map((d, i) => (
            <div key={d.label} className="plx-bars__col" title={`${d.label}: ${d.views}`}>
              <div className="plx-bars__bar" style={{ height: `${Math.max(3, (d.views / max) * 100)}%`, opacity: d.views ? 1 : 0.35 }} />
              <span className="plx-bars__lab">{i % 2 === 0 ? d.label.replace(/ /g, " ") : " "}</span>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}
