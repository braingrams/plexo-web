"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import Link from "next/link";
import type { TemplateKind } from "@prisma/client";

export type OverviewTemplateRow = {
  id: string;
  name: string;
  kind: TemplateKind;
  updatedAt: string;
  pageCount: number;
  isLive: boolean;
};

export type NeedsAttentionItem = {
  id: string;
  title: string;
  subtitle: string;
  actionLabel: string;
  href: string;
  tone: "warning" | "info";
};

export type ActivityItem = {
  id: string;
  text: string;
  when: string;
};

type Props = {
  organizationName: string;
  plan: string;
  templatesCount: number;
  liveTemplatesCount: number;
  domainsCount: number;
  unverifiedDomainsCount: number;
  apiKeysCount: number;
  /** Page views in the 7-day window before the current one — lets the client compute a
   * real trend percentage once the current window's total arrives from /api/v1/analytics. */
  previousViews7d: number;
  recentTemplates: OverviewTemplateRow[];
  needsAttention: NeedsAttentionItem[];
  recentActivity: ActivityItem[];
};

type TimelineDay = { date: string; views: number; uniqueVisitors: number };

const hairline = "rgba(255,255,255,0.09)";
const hairlineSoft = "rgba(255,255,255,0.055)";

function IconTrendUp() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="6 11 12 5 18 11" />
    </svg>
  );
}

function IconTrendDown() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <polyline points="6 13 12 19 18 13" />
    </svg>
  );
}

function IconMarketplace() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ec4899" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 8l1.5-4h13L20 8" />
      <path d="M4 8h16v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V8z" />
      <path d="M9 12a3 3 0 0 0 6 0" />
    </svg>
  );
}

function IconBrain() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z" />
      <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z" />
    </svg>
  );
}

function IconSdk() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  );
}

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

function TrafficChart({ chartData }: { chartData: TimelineDay[] }) {
  const width = 900;
  const height = 168;
  const top = 14;
  const baseline = 138;
  const plotHeight = baseline - top;
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const { pathD, areaD, points, maxVal } = useMemo(() => {
    if (chartData.length === 0) {
      return { pathD: "", areaD: "", points: [] as { x: number; y: number }[], maxVal: 0 };
    }
    const max = Math.max(1, ...chartData.map((d) => d.views));
    const step = width / Math.max(1, chartData.length - 1);
    const pts = chartData.map((d, i) => ({
      x: i * step,
      y: top + plotHeight - (d.views / max) * plotHeight,
    }));
    const line = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
    const area = line ? `${line} L ${pts[pts.length - 1].x} ${baseline} L ${pts[0].x} ${baseline} Z` : "";
    return { pathD: line, areaD: area, points: pts, maxVal: max };
  }, [chartData]);

  const activeIndex = hoverIndex ?? points.length - 1;
  const active = points[activeIndex];
  const activeDay = chartData[activeIndex];
  const gridLines = [0.25, 0.5, 0.75].map((r) => top + plotHeight * r);

  function handleMove(e: ReactMouseEvent<SVGSVGElement>) {
    if (!svgRef.current || points.length === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const idx = Math.round(ratio * (points.length - 1));
    setHoverIndex(Math.min(points.length - 1, Math.max(0, idx)));
  }

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6, minHeight: 34 }}>
        {activeDay && (
          <div style={{ textAlign: "right" }}>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 15, fontWeight: 650, color: "var(--text-main)" }}>
              {activeDay.views.toLocaleString()} views
            </div>
            <div style={{ fontSize: "10.5px", color: "var(--text-faint)" }}>
              {hoverIndex === null ? "latest" : "on"} &middot; {activeDay.date}
            </div>
          </div>
        )}
      </div>
      <svg
        ref={svgRef}
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        style={{ display: "block", cursor: points.length > 1 ? "crosshair" : "default" }}
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIndex(null)}
      >
        <defs>
          <linearGradient id="overviewChartFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0" />
          </linearGradient>
        </defs>
        {gridLines.map((y) => (
          <line key={y} x1="0" y1={y} x2={width} y2={y} stroke={hairlineSoft} strokeWidth="1" />
        ))}
        <line x1="0" y1={baseline} x2={width} y2={baseline} stroke={hairline} strokeWidth="1" />
        {areaD && <path d={areaD} fill="url(#overviewChartFill)" />}
        {pathD && (
          <path d={pathD} fill="none" stroke="#8b5cf6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        )}
        {active && hoverIndex !== null && (
          <line x1={active.x} y1={top} x2={active.x} y2={baseline} stroke="rgba(139,92,246,0.35)" strokeWidth="1" strokeDasharray="3 3" />
        )}
        {active && (
          <circle
            cx={active.x}
            cy={active.y}
            r={hoverIndex === null ? 3 : 4.5}
            fill={hoverIndex === null ? "#8b5cf6" : "#0d0f1a"}
            stroke="#8b5cf6"
            strokeWidth={hoverIndex === null ? 0 : 2}
          />
        )}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10 }}>
        {chartData.map((d, i) => (
          <span
            key={d.date}
            style={{
              fontSize: "10.5px",
              color: i === activeIndex ? "var(--text-main)" : "var(--text-muted)",
              fontWeight: i === activeIndex ? 650 : 400,
            }}
          >
            {d.date}
          </span>
        ))}
      </div>
      {maxVal === 0 && (
        <p style={{ marginTop: 10, fontSize: "12.5px", color: "var(--text-faint)" }}>No views recorded in this window yet.</p>
      )}
    </>
  );
}

function toneColor(tone: "warning" | "info"): string {
  return tone === "warning" ? "var(--warning)" : "#38bdf8";
}

function kindLabel(kind: TemplateKind): string {
  return kind === "LANDING_PAGE" ? "Landing Page" : "Email";
}

export function OverviewClient(props: Props) {
  const {
    organizationName,
    plan,
    templatesCount,
    liveTemplatesCount,
    domainsCount,
    unverifiedDomainsCount,
    apiKeysCount,
    previousViews7d,
    recentTemplates,
    needsAttention,
    recentActivity,
  } = props;

  const [chartData, setChartData] = useState<TimelineDay[]>([]);
  const [totalViews, setTotalViews] = useState<number | null>(null);
  const [loadingViews, setLoadingViews] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/analytics")
      .then((res) => res.json())
      .then((data) => {
        if (cancelled || !data.success) return;
        setChartData(data.chartData ?? []);
        setTotalViews(data.totalViews ?? 0);
      })
      .catch(() => {
        if (!cancelled) setTotalViews(0);
      })
      .finally(() => {
        if (!cancelled) setLoadingViews(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const viewsTrendPct = useMemo(() => {
    if (totalViews === null || previousViews7d <= 0) return null;
    return ((totalViews - previousViews7d) / previousViews7d) * 100;
  }, [totalViews, previousViews7d]);

  return (
    <div style={{ color: "var(--text-main)" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "2.5rem" }}>
        <div>
          <h1 style={{ margin: "0 0 6px", fontSize: "30px", fontWeight: 700, letterSpacing: "-0.02em" }}>Overview</h1>
          <p style={{ margin: 0, fontSize: "13.5px", color: "var(--text-muted)" }}>
            {organizationName} &middot; {plan} plan
          </p>
        </div>
        <Link
          href="/dashboard/new"
          style={{
            fontSize: "13px",
            fontWeight: 650,
            color: "var(--bg)",
            background: "var(--text-main)",
            padding: "9px 16px",
            borderRadius: 7,
            textDecoration: "none",
          }}
        >
          Host a site
        </Link>
      </div>

      {/* Stat strip */}
      <div style={{ height: 1, background: hairline }} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", padding: "26px 0" }}>
        <div style={{ paddingRight: 32 }}>
          <div style={{ fontSize: "10.5px", fontWeight: 650, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 12 }}>
            Templates
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "38px", fontWeight: 600, letterSpacing: "-0.02em", marginBottom: 8 }}>
            {templatesCount}
          </div>
          <div style={{ fontSize: "12.5px", color: "var(--text-muted)" }}>
            <span style={{ color: "var(--success)", fontWeight: 650 }}>{liveTemplatesCount}</span> live
          </div>
        </div>
        <div style={{ padding: "0 32px", borderLeft: `1px solid ${hairlineSoft}` }}>
          <div style={{ fontSize: "10.5px", fontWeight: 650, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 12 }}>
            Live domains
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "38px", fontWeight: 600, letterSpacing: "-0.02em", marginBottom: 8 }}>
            {domainsCount}
          </div>
          <div style={{ fontSize: "12.5px", color: "var(--text-muted)" }}>
            {unverifiedDomainsCount > 0 ? (
              <>
                <span style={{ color: "var(--warning)", fontWeight: 650 }}>{unverifiedDomainsCount}</span> pending verification
              </>
            ) : (
              "All verified"
            )}
          </div>
        </div>
        <div style={{ padding: "0 32px", borderLeft: `1px solid ${hairlineSoft}` }}>
          <div style={{ fontSize: "10.5px", fontWeight: 650, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 12 }}>
            Views &middot; 7d
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "38px", fontWeight: 600, letterSpacing: "-0.02em", marginBottom: 8 }}>
            {loadingViews ? "—" : (totalViews ?? 0).toLocaleString()}
          </div>
          <div style={{ fontSize: "12.5px", color: "var(--text-muted)" }}>
            {viewsTrendPct === null ? (
              "vs previous 7d"
            ) : (
              <>
                <span
                  style={{
                    color: viewsTrendPct >= 0 ? "var(--success)" : "var(--danger)",
                    fontWeight: 650,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 3,
                  }}
                >
                  {viewsTrendPct >= 0 ? <IconTrendUp /> : <IconTrendDown />}
                  {Math.abs(viewsTrendPct).toFixed(1)}%
                </span>{" "}
                vs previous 7d
              </>
            )}
          </div>
        </div>
        <div style={{ paddingLeft: 32, borderLeft: `1px solid ${hairlineSoft}` }}>
          <div style={{ fontSize: "10.5px", fontWeight: 650, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 12 }}>
            API keys
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "38px", fontWeight: 600, letterSpacing: "-0.02em", marginBottom: 8 }}>
            {apiKeysCount}
          </div>
          <div style={{ fontSize: "12.5px", color: "var(--text-muted)" }}>
            <Link href="/dashboard/settings/api-keys" style={{ color: "var(--brand)", fontWeight: 600 }}>
              View keys
            </Link>
          </div>
        </div>
      </div>
      <div style={{ height: 1, background: hairline }} />

      {/* Traffic + Needs attention */}
      <div style={{ display: "flex", alignItems: "stretch", padding: "32px 0" }}>
        <div style={{ flex: "0 0 65%", paddingRight: 40 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 22 }}>
            <span style={{ fontSize: "10.5px", fontWeight: 650, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-muted)" }}>
              Traffic &middot; 7 days
            </span>
            <Link href="/dashboard/insights" style={{ fontSize: "12.5px", fontWeight: 650, color: "var(--brand)", textDecoration: "none" }}>
              Open Insights &rarr;
            </Link>
          </div>
          <TrafficChart chartData={chartData} />
        </div>

        <div style={{ width: 1, background: hairline, alignSelf: "stretch" }} />

        <div style={{ flex: 1, paddingLeft: 40 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
            <span style={{ fontSize: "10.5px", fontWeight: 650, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-muted)" }}>
              Needs attention
            </span>
            {needsAttention.length > 0 && (
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--text-muted)" }}>{needsAttention.length}</span>
            )}
          </div>

          {needsAttention.length === 0 ? (
            <p style={{ fontSize: "12.5px", color: "var(--text-faint)", margin: 0 }}>All caught up — nothing needs your attention.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {needsAttention.map((item, i) => (
                <div
                  key={item.id}
                  style={{
                    padding: "13px 0",
                    borderTop: `1px solid ${hairlineSoft}`,
                    borderBottom: i === needsAttention.length - 1 ? `1px solid ${hairlineSoft}` : undefined,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                    <span style={{ fontSize: "13px", fontWeight: 650 }}>{item.title}</span>
                    <Link
                      href={item.href}
                      style={{
                        fontSize: "11.5px",
                        fontWeight: 700,
                        color: toneColor(item.tone),
                        textTransform: "uppercase",
                        letterSpacing: "0.03em",
                        textDecoration: "none",
                      }}
                    >
                      {item.actionLabel}
                    </Link>
                  </div>
                  <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>{item.subtitle}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent templates + Activity */}
      <div style={{ display: "flex", alignItems: "stretch", padding: "0 0 32px" }}>
        <div style={{ flex: "0 0 65%", paddingRight: 40 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 18 }}>
            <span style={{ fontSize: "10.5px", fontWeight: 650, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-muted)" }}>
              Recent templates
            </span>
            <Link href="/dashboard/templates" style={{ fontSize: "12.5px", fontWeight: 650, color: "var(--brand)", textDecoration: "none" }}>
              View all &rarr;
            </Link>
          </div>

          <div style={{ display: "flex", paddingBottom: 10, borderBottom: `1px solid ${hairline}` }}>
            <span style={{ flex: 1, fontSize: "10.5px", fontWeight: 650, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-faint)" }}>Name</span>
            <span style={{ width: 100, fontSize: "10.5px", fontWeight: 650, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-faint)" }}>Type</span>
            <span style={{ width: 60, fontSize: "10.5px", fontWeight: 650, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-faint)", textAlign: "right" }}>Pages</span>
            <span style={{ width: 90, fontSize: "10.5px", fontWeight: 650, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-faint)", textAlign: "right" }}>Updated</span>
          </div>

          {recentTemplates.length === 0 ? (
            <p style={{ fontSize: "12.5px", color: "var(--text-faint)", padding: "16px 0 0" }}>No templates yet.</p>
          ) : (
            recentTemplates.map((t, i) => (
              <Link
                key={t.id}
                href={`/dashboard/templates/${t.id}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "13px 0",
                  borderBottom: i === recentTemplates.length - 1 ? undefined : `1px solid ${hairlineSoft}`,
                  textDecoration: "none",
                  color: "inherit",
                }}
              >
                <span style={{ flex: 1, display: "flex", alignItems: "center", gap: 9, fontSize: "13.5px", fontWeight: 600 }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: t.isLive ? "var(--success)" : "var(--text-faint)", flexShrink: 0 }} />
                  {t.name}
                </span>
                <span style={{ width: 100, fontSize: "12.5px", color: "var(--text-muted)" }}>{kindLabel(t.kind)}</span>
                <span style={{ width: 60, fontSize: "12.5px", color: "var(--text-muted)", textAlign: "right", fontFamily: "var(--font-mono)" }}>
                  {t.kind === "LANDING_PAGE" ? t.pageCount + 1 : "—"}
                </span>
                <span style={{ width: 90, fontSize: "12.5px", color: "var(--text-faint)", textAlign: "right" }}>{timeAgo(t.updatedAt)}</span>
              </Link>
            ))
          )}
        </div>

        <div style={{ width: 1, background: hairline, alignSelf: "stretch" }} />

        <div style={{ flex: 1, paddingLeft: 40 }}>
          <div style={{ fontSize: "10.5px", fontWeight: 650, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 18 }}>
            Activity
          </div>
          {recentActivity.length === 0 ? (
            <p style={{ fontSize: "12.5px", color: "var(--text-faint)", margin: 0 }}>Nothing to show yet.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 15 }}>
              {recentActivity.map((item) => (
                <div key={item.id} style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-muted)", flexShrink: 0, minWidth: 50 }}>
                    {timeAgo(item.when)}
                  </span>
                  <span style={{ fontSize: "12.5px", color: "var(--text-muted)", lineHeight: 1.5 }}>{item.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Footer discovery links */}
      <div style={{ height: 1, background: hairline, marginTop: 4 }} />
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 28, paddingTop: 22 }}>
        <Link href="/dashboard/marketplace" style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: "12.5px", fontWeight: 600, color: "var(--text-muted)", textDecoration: "none" }}>
          <IconMarketplace /> Marketplace
        </Link>
        <Link href="/dashboard/integrations" style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: "12.5px", fontWeight: 600, color: "var(--text-muted)", textDecoration: "none" }}>
          <IconBrain /> AI integrations
        </Link>
        <Link href="/dashboard/sdk" style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: "12.5px", fontWeight: 600, color: "var(--text-muted)", textDecoration: "none" }}>
          <IconSdk /> API &amp; SDK
        </Link>
      </div>
    </div>
  );
}
