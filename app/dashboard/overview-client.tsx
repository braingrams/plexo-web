"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { TemplateCard, type TemplateSummary } from "./templates/TemplateCard";
import { Card } from "./_components/Card";
import { TrafficChart, type TimelineDay } from "./_components/TrafficChart";
import { ActivityHeatmap, type HeatmapPoint } from "./_components/ActivityHeatmap";

type Props = {
  userName: string;
  plan: string;
  hasTemplates: boolean;
  hasDomains: boolean;
  hasApiKeys: boolean;
  hasViews: boolean;
  templatesCount: number;
  domainsCount: number;
  apiKeysCount: number;
  recentTemplates: TemplateSummary[];
};

function IconChevron({ open }: { open: boolean }) {
  return (
    <svg
      width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
      strokeLinecap="round" strokeLinejoin="round"
      style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function IconPlus() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  );
}

function IconLayers() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" />
    </svg>
  );
}

function IconGlobe() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function IconKey() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </svg>
  );
}

function IconEyeSmall() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/** Tiny 7-point trend line, no axes/labels — just enough to show shape-of-week at a glance
 * inside a stat tile. Real data (same chartData as the Traffic section), no invented numbers. */
function Sparkline({ data }: { data: TimelineDay[] }) {
  const { d, points } = useMemo(() => {
    if (data.length === 0) return { d: "", points: [] as { x: number; y: number }[] };
    const w = 100;
    const h = 28;
    const max = Math.max(1, ...data.map((p) => p.views));
    const pts = data.map((p, i) => ({
      x: (i / Math.max(1, data.length - 1)) * w,
      y: h - (p.views / max) * (h - 4) - 2,
    }));
    return { d: pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" "), points: pts };
  }, [data]);

  if (!d) return null;
  return (
    <svg width="100%" height="28" viewBox="0 0 100 28" preserveAspectRatio="none" style={{ display: "block" }}>
      <path d={d} fill="none" stroke="var(--brand)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {points.length > 0 && <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r="2.5" fill="var(--brand)" />}
    </svg>
  );
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "Working late";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function OverviewClient({
  userName,
  plan,
  hasTemplates,
  hasDomains,
  hasApiKeys,
  hasViews,
  templatesCount,
  domainsCount,
  apiKeysCount,
  recentTemplates,
}: Props) {
  const steps = [
    { id: "templates", label: "Create your first template", done: hasTemplates, link: "/dashboard/templates", linkText: "Create template ➔" },
    { id: "api-keys", label: "Configure an API Key for AI visual tools", done: hasApiKeys, link: "/dashboard/settings", linkText: "Create API Key ➔" },
    { id: "domains", label: "Link a platform subdomain or custom domain", done: hasDomains, link: "/dashboard/domains", linkText: "Configure domains ➔" },
    { id: "views", label: "Get visitors to view your published page", done: hasViews, statusText: hasViews ? "Completed ✓" : "Waiting for views…" },
  ];

  const completedSteps = steps.filter((s) => s.done).length;
  const onboardingPercentage = Math.round((completedSteps / steps.length) * 100);
  const onboardingComplete = onboardingPercentage === 100;

  const [stepsExpanded, setStepsExpanded] = useState(false);

  const [totalViews, setTotalViews] = useState(0);
  const [chartData, setChartData] = useState<TimelineDay[]>([]);
  const [heatmapData, setHeatmapData] = useState<HeatmapPoint[]>([]);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);

  useEffect(() => {
    fetch("/api/v1/analytics")
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setTotalViews(data.totalViews);
          setChartData(data.chartData ?? []);
          setHeatmapData(data.heatmap ?? []);
        }
      })
      .catch((err) => console.error("Error loading analytics:", err))
      .finally(() => setAnalyticsLoading(false));
  }, []);

  const hasAnyViews = chartData.some((d) => d.views > 0);

  const stats = [
    { label: "Templates", value: templatesCount, link: "/dashboard/templates", icon: <IconLayers /> },
    { label: "Live Domains", value: domainsCount, link: "/dashboard/domains", icon: <IconGlobe /> },
    { label: "API Keys", value: apiKeysCount, link: "/dashboard/settings", icon: <IconKey /> },
    { label: "Views (7d)", value: totalViews, link: "/dashboard/insights", icon: <IconEyeSmall />, sparkline: true },
  ];

  return (
    <>
      {/* Hero */}
      <Card
        style={{
          marginBottom: "1.5rem",
          background: "linear-gradient(135deg, rgba(139,92,246,0.14), rgba(129,140,248,0.04) 60%, transparent)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: "1.25rem" }}>
          <div>
            <span style={{
              fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase",
              color: "var(--brand)",
            }}>
              {greeting()}
            </span>
            <h1 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "clamp(1.5rem, 4vw, 2.3rem)", fontWeight: 800, color: "#f0f2ff", letterSpacing: "-0.025em", lineHeight: 1.15, margin: "0.3rem 0 0" }}>
              {userName}
            </h1>
            <p style={{ fontSize: "0.85rem", color: "rgba(240,242,255,0.5)", marginTop: "0.5rem", maxWidth: 440 }}>
              Here&apos;s what&apos;s happening across your workspace right now.
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexShrink: 0 }}>
            <span style={{
              fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.08em",
              textTransform: "uppercase", color: "var(--brand)",
              background: "var(--brand-subtle)", padding: "0.4rem 0.8rem", borderRadius: 8,
              border: "1px solid rgba(139,92,246,0.15)",
            }}>
              {plan} account
            </span>
            <Link
              href="/dashboard/templates"
              style={{
                display: "inline-flex", alignItems: "center", gap: "0.5rem",
                padding: "0.7rem 1.25rem", borderRadius: 10, fontWeight: 700, fontSize: "0.85rem",
                background: "linear-gradient(135deg,var(--brand),var(--brand-deep))",
                color: "#fff", textDecoration: "none",
                boxShadow: "0 8px 28px var(--brand-glow)",
              }}
            >
              <IconPlus />
              New Template
            </Link>
          </div>
        </div>
      </Card>

      {/* Compact onboarding strip — only while setup isn't complete. */}
      {!onboardingComplete && (
        <Card padded={false} style={{ marginBottom: "1.5rem", overflow: "hidden" }}>
          <button
            type="button"
            onClick={() => setStepsExpanded((v) => !v)}
            style={{
              width: "100%", display: "flex", alignItems: "center", gap: "1rem",
              padding: "0.85rem 1.1rem", background: "none", border: "none", cursor: "pointer",
              fontFamily: "inherit", textAlign: "left",
            }}
          >
            <span style={{ fontSize: "0.82rem", fontWeight: 650, color: "#f0f2ff", whiteSpace: "nowrap" }}>
              Workspace setup — {completedSteps}/{steps.length}
            </span>
            <span style={{ flex: 1, height: 5, background: "rgba(255,255,255,0.05)", borderRadius: 999, overflow: "hidden" }}>
              <span style={{ display: "block", width: `${onboardingPercentage}%`, height: "100%", background: "linear-gradient(90deg, var(--brand), #a78bfa)", borderRadius: 999, transition: "width 0.5s ease" }} />
            </span>
            <span style={{ color: "rgba(240,242,255,0.4)", display: "flex", alignItems: "center", flexShrink: 0 }}>
              <IconChevron open={stepsExpanded} />
            </span>
          </button>

          {stepsExpanded && (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", padding: "0 1.1rem 1rem" }}>
              {steps.map((step) => (
                <div key={step.id} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "0.65rem 0.85rem", borderRadius: 10,
                  background: step.done ? "rgba(16,185,129,0.03)" : "rgba(255,255,255,0.01)",
                  border: step.done ? "1px solid rgba(16,185,129,0.1)" : "1px solid rgba(255,255,255,0.04)",
                  fontSize: "0.8rem"
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.65rem" }}>
                    <div style={{
                      width: 18, height: 18, borderRadius: "50%",
                      background: step.done ? "rgba(16,185,129,0.1)" : "rgba(255,255,255,0.03)",
                      border: step.done ? "1px solid rgba(16,185,129,0.15)" : "1px solid rgba(255,255,255,0.06)",
                      display: "grid", placeItems: "center", fontSize: "0.65rem", flexShrink: 0,
                    }}>
                      {step.done ? "✓" : ""}
                    </div>
                    <span style={{ color: step.done ? "rgba(240,242,255,0.75)" : "rgba(240,242,255,0.45)", fontWeight: step.done ? 600 : 400 }}>
                      {step.label}
                    </span>
                  </div>
                  {step.done ? (
                    <span style={{ color: "#34d399", fontWeight: 700, fontSize: "0.72rem" }}>
                      Completed
                    </span>
                  ) : step.link ? (
                    <Link href={step.link} style={{ color: "var(--brand)", textDecoration: "none", fontWeight: 700, fontSize: "0.72rem" }}>
                      {step.linkText}
                    </Link>
                  ) : (
                    <span style={{ color: "rgba(240,242,255,0.25)", fontSize: "0.7rem", fontStyle: "italic" }}>
                      {step.statusText}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* KPI row */}
      <div className="stat-glance-row" style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: "0.85rem",
        marginBottom: "1.5rem",
      }}>
        {stats.map((stat) => (
          <Link key={stat.label} href={stat.link} style={{ textDecoration: "none" }}>
            <Card style={{ height: "100%", transition: "border-color 0.15s, transform 0.15s" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.6rem" }}>
                <span style={{ fontSize: "0.66rem", fontWeight: 700, color: "rgba(240,242,255,0.35)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  {stat.label}
                </span>
                <span style={{ color: "var(--brand)", opacity: 0.7, display: "flex" }}>{stat.icon}</span>
              </div>
              <span style={{ fontSize: "1.6rem", fontWeight: 800, color: "#f0f2ff", display: "block" }}>
                {stat.value.toLocaleString()}
              </span>
              {stat.sparkline && (
                <div style={{ marginTop: "0.5rem" }}>
                  <Sparkline data={chartData} />
                </div>
              )}
            </Card>
          </Link>
        ))}
      </div>

      {/* Traffic — real analytics, front and center on the main dashboard, not just Insights */}
      <div className="overview-traffic-row" style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: "1.25rem", marginBottom: "2rem" }}>
        <Card>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "1rem" }}>
            <div>
              <h2 style={{ fontSize: "1.05rem", fontWeight: 700, color: "#f0f2ff", margin: 0 }}>Traffic, last 7 days</h2>
              <p style={{ fontSize: "0.8rem", color: "rgba(240,242,255,0.4)", margin: "0.25rem 0 0" }}>
                Views and unique visitors across every published page.
              </p>
            </div>
            <Link href="/dashboard/insights" style={{ fontSize: "0.78rem", fontWeight: 650, color: "var(--brand)", textDecoration: "none", whiteSpace: "nowrap" }}>
              Full insights →
            </Link>
          </div>
          {analyticsLoading ? (
            <div style={{ height: 200, display: "grid", placeItems: "center", color: "rgba(240,242,255,0.3)", fontSize: "0.85rem" }}>
              Loading…
            </div>
          ) : hasAnyViews ? (
            <TrafficChart chartData={chartData} height={200} />
          ) : (
            <div style={{ height: 200, display: "grid", placeItems: "center", color: "rgba(240,242,255,0.3)", fontSize: "0.85rem", textAlign: "center" }}>
              No visits yet — this fills in once your pages get traffic.
            </div>
          )}
        </Card>

        <Card>
          <h2 style={{ fontSize: "1.05rem", fontWeight: 700, color: "#f0f2ff", margin: 0 }}>Activity by time</h2>
          <p style={{ fontSize: "0.8rem", color: "rgba(240,242,255,0.4)", margin: "0.25rem 0 1rem" }}>
            When visitors show up, last 7 days.
          </p>
          <ActivityHeatmap data={heatmapData} />
        </Card>
      </div>

      {/* Templates */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap", marginBottom: "1.25rem" }}>
        <div>
          <h2 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "1.3rem", fontWeight: 800, color: "#f0f2ff", margin: 0 }}>
            Your Templates
          </h2>
          <p style={{ fontSize: "0.8rem", color: "rgba(240,242,255,0.4)", margin: "0.25rem 0 0" }}>
            Recently updated email templates and landing pages.
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.6rem", flexShrink: 0 }}>
          {recentTemplates.length > 0 && (
            <Link
              href="/dashboard/templates"
              style={{
                display: "inline-flex", alignItems: "center", padding: "0.6rem 1rem",
                borderRadius: 9, fontSize: "0.82rem", fontWeight: 650,
                color: "rgba(240,242,255,0.65)", textDecoration: "none",
                border: "1px solid rgba(255,255,255,0.1)",
              }}
            >
              View all →
            </Link>
          )}
          <Link
            href="/dashboard/templates"
            style={{
              display: "inline-flex", alignItems: "center", gap: "0.5rem",
              padding: "0.6rem 1.1rem", borderRadius: 9, fontWeight: 700, fontSize: "0.82rem",
              background: "linear-gradient(135deg,var(--brand),var(--brand-deep))",
              color: "#fff", textDecoration: "none",
              boxShadow: "0 4px 20px var(--brand-glow)",
            }}
          >
            <IconPlus />
            New Template
          </Link>
        </div>
      </div>

      {recentTemplates.length > 0 ? (
        <div className="overview-templates-grid" style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: "1.25rem",
          marginBottom: "2rem",
        }}>
          {recentTemplates.map((template) => (
            <TemplateCard key={template.id} template={template} />
          ))}
        </div>
      ) : (
        <Card style={{ textAlign: "center", padding: "3rem 2rem", marginBottom: "2rem", border: "1px dashed rgba(255,255,255,0.1)" }}>
          <h3 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "1.05rem", color: "#f0f2ff", marginBottom: "0.5rem" }}>
            No templates yet.
          </h3>
          <p style={{ fontSize: "0.85rem", color: "rgba(240,242,255,0.4)", marginBottom: "1.5rem" }}>
            Create your first email template or landing page to get started.
          </p>
          <Link
            href="/dashboard/templates"
            style={{
              display: "inline-flex", alignItems: "center", gap: "0.5rem",
              padding: "0.65rem 1.25rem",
              borderRadius: 10, fontSize: "0.875rem", fontWeight: 700,
              background: "linear-gradient(135deg,var(--brand),var(--brand-deep))",
              color: "#fff", textDecoration: "none",
              boxShadow: "0 4px 20px var(--brand-glow)",
            }}
          >
            <IconPlus />
            Create First Template
          </Link>
        </Card>
      )}

      <style jsx>{`
        @media (max-width: 700px) {
          .stat-glance-row {
            grid-template-columns: repeat(2, 1fr) !important;
          }
        }
        @media (max-width: 900px) {
          .overview-traffic-row {
            grid-template-columns: 1fr !important;
          }
        }
        @media (max-width: 420px) {
          .overview-templates-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </>
  );
}
