"use client";

import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";
import type { SiteSummary } from "@/lib/dashboardV3/sites";
import type { SiteStats } from "@/lib/dashboardV3/homeData";
import { Badge, ButtonLink, Card, CardHeader, EmptyState } from "../ui";
import { timeAgo } from "./api";

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
    <div data-tour="home-stats" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14 }}>
      {stats.map((s) => (
        <StatTile key={s.id} label={s.label} value={s.value} hint={s.hint} />
      ))}
    </div>
  );
}

export function ActivityCard({ stats, site }: { stats: SiteStats; site: SiteSummary }) {
  return (
    <Card padding="lg">
      <CardHeader title={stats.activityTitle} action={stats.activity.length ? <Link href={`/dashboard/sites/${site.id}`} className="plx-small" style={{ color: "var(--plx-link)", fontWeight: 700 }}>See all</Link> : undefined} />
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

export function CreateAnotherCard({ href }: { href: string }) {
  return (
    <Card tone="tint" style={{ display: "flex", flexDirection: "column", gap: 10 }} data-tour="home-create-another">
      <span className="plx-h3">Have another idea?</span>
      <span className="plx-body">Start a second website. Your first one keeps running as it is.</span>
      <div>
        <ButtonLink href={href} variant="secondary" leftIcon={<Plus size={18} aria-hidden />} rightIcon={<ArrowRight size={16} aria-hidden />}>
          Create another website
        </ButtonLink>
      </div>
    </Card>
  );
}
