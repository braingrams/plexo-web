"use client";

import { useState } from "react";
import { Card, CardHeader, EmptyState, SegmentedControl } from "../ui";
import type { HubVisits, HubVisitRow } from "@/lib/dashboardV3/hubData";
import { TabBar } from "./HubFrame";
import { GoogleVisits, Rank } from "./GoogleVisits";

function formatVisitLocation(v: HubVisitRow): string {
  const parts = [v.city, v.region, v.country].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "Unknown";
}

function formatVisitDevice(v: HubVisitRow): string {
  const dev = v.deviceType || "Desktop";
  return v.os ? `${dev} · ${v.os}` : dev;
}

export function VisitsTab({ visits, siteId, live, gaResult }: { visits: HubVisits; siteId: string; live: boolean; gaResult?: string }) {
  const [source, setSource] = useState<"plexo" | "google">(gaResult ? "google" : "plexo");
  const max = Math.max(1, ...visits.days.map((d) => d.views));
  const last7 = visits.days.slice(-7).reduce((s, d) => s + d.views, 0);
  const best = visits.days.reduce((b, d) => (d.views > b.views ? d : b), visits.days[0] ?? { label: "", views: 0 });

  const devices = visits.devices ?? [];
  const countries = visits.countries ?? [];
  const browsers = visits.browsers ?? [];
  const os = visits.os ?? [];
  const recent = visits.recent ?? [];

  return (
    <>
      <TabBar
        title="Your visits"
        sub="How many times people looked at your site over the last two weeks."
      />
      <div className="plx-hstats" data-tour="hub-visits">
        <Card className="plx-hstat"><b>{visits.total}</b><span>visits in 14 days</span></Card>
        <Card className="plx-hstat"><b>{last7}</b><span>visits this week</span></Card>
        <Card className="plx-hstat"><b>{best.views}</b><span>{best.views ? `on your busiest day (${best.label})` : "on your busiest day"}</span></Card>
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

      <section style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 8 }} aria-label="Visitor breakdown">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div>
            <h2 className="plx-h2" style={{ margin: 0 }}>See where your visitors come from</h2>
            <p className="plx-body" style={{ margin: "4px 0 0", color: "var(--plx-muted)" }}>
              {source === "plexo"
                ? "Devices, locations, and browsers recorded directly by Plexo."
                : "Detailed visitor numbers, locations, and traffic sources from Google Analytics."}
            </p>
          </div>
          <SegmentedControl
            label="Visitor source"
            value={source}
            onChange={setSource}
            options={[
              { value: "plexo", label: "Plexo records" },
              { value: "google", label: "Google Analytics" },
            ]}
          />
        </div>

        {source === "plexo" ? (
          visits.total === 0 && devices.length === 0 ? (
            <Card>
              <EmptyState
                compact
                title="No visitor details yet"
                body="Once people visit your published site, their locations, devices, and browsers will show up here."
              />
            </Card>
          ) : (
            <>
              <div className="plx-hga__cols">
                <Rank title="What they use" description="Phone, computer or tablet." items={devices} unit="visits" />
                <Rank title="Countries" description="Where visitors are located." items={countries} unit="visits" />
                <Rank title="Browsers" description="Web browsers used to view your site." items={browsers} unit="visits" />
                <Rank title="Operating systems" description="Platforms your visitors use." items={os} unit="visits" />
              </div>

              {recent.length > 0 ? (
                <Card padding="none" style={{ overflow: "hidden" }}>
                  <div style={{ padding: "20px 22px 12px" }}>
                    <CardHeader title="Visitor activity" description="Recent visits recorded by Plexo." />
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", minWidth: 640, borderCollapse: "collapse", fontSize: 14 }}>
                      <thead>
                        <tr style={{ textAlign: "left", color: "var(--plx-muted)", borderBottom: "1px solid var(--plx-border)" }}>
                          <th scope="col" style={{ padding: "10px 22px", fontWeight: 600, fontSize: 13 }}>Time</th>
                          <th scope="col" style={{ padding: "10px 18px", fontWeight: 600, fontSize: 13 }}>Location</th>
                          <th scope="col" style={{ padding: "10px 18px", fontWeight: 600, fontSize: 13 }}>Device & OS</th>
                          <th scope="col" style={{ padding: "10px 18px", fontWeight: 600, fontSize: 13 }}>Browser</th>
                          <th scope="col" style={{ padding: "10px 22px", fontWeight: 600, fontSize: 13 }}>Address</th>
                        </tr>
                      </thead>
                      <tbody>
                        {recent.map((v) => (
                          <tr key={v.id} style={{ borderTop: "1px solid var(--plx-border)" }}>
                            <td style={{ padding: "12px 22px", whiteSpace: "nowrap", color: "var(--plx-muted)", fontSize: 13 }}>
                              {new Date(v.createdAt).toLocaleDateString("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                            </td>
                            <td style={{ padding: "12px 18px", fontWeight: 600 }}>{formatVisitLocation(v)}</td>
                            <td style={{ padding: "12px 18px", whiteSpace: "nowrap" }}>{formatVisitDevice(v)}</td>
                            <td style={{ padding: "12px 18px" }}>{v.browser || "Unknown"}</td>
                            <td style={{ padding: "12px 22px", color: "var(--plx-muted)", fontSize: 13 }}>{v.domain || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              ) : null}
            </>
          )
        ) : (
          <GoogleVisits siteId={siteId} live={live} result={gaResult} embedded />
        )}
      </section>
    </>
  );
}
