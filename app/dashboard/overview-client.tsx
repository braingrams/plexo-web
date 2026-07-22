"use client";

import React, { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { CustomSelect } from "./domains/domains-client";

type TimelineDay = {
  date: string;
  views: number;
  uniqueVisitors: number;
};

type TemplateItem = {
  id: string;
  name: string;
};

type Props = {
  userName: string;
  plan: string;
  hasTemplates: boolean;
  hasDomains: boolean;
  hasApiKeys: boolean;
  hasViews: boolean;
};

export function OverviewClient({
  userName,
  plan,
  hasTemplates,
  hasDomains,
  hasApiKeys,
  hasViews,
}: Props) {
  // Onboarding steps calculations
  const steps = [
    { id: "templates", label: "Create your first template", done: hasTemplates, link: "/dashboard/templates", linkText: "Create template ➔" },
    { id: "api-keys", label: "Configure an API Key for AI visual tools", done: hasApiKeys, link: "/dashboard/settings", linkText: "Create API Key ➔" },
    { id: "domains", label: "Link a platform subdomain or custom domain", done: hasDomains, link: "/dashboard/domains", linkText: "Configure domains ➔" },
    { id: "views", label: "Get visitors to view your published page", done: hasViews, statusText: hasViews ? "Completed ✓" : "Waiting for views…" },
  ];

  const completedSteps = steps.filter((s) => s.done).length;
  const onboardingPercentage = Math.round((completedSteps / steps.length) * 100);

  // Analytics Filter States
  const [filterType, setFilterType] = useState<"all" | "published">("all");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  
  // Data from API
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [totalViews, setTotalViews] = useState(0);
  const [totalUnique, setTotalUnique] = useState(0);
  const [chartData, setChartData] = useState<TimelineDay[]>([]);

  useEffect(() => {
    setLoading(true);
    const query = new URLSearchParams();
    if (selectedTemplateId !== "all") {
      query.set("templateId", selectedTemplateId);
    } else if (filterType === "published") {
      query.set("filter", "published");
    }

    fetch(`/api/v1/analytics?${query.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setTotalViews(data.totalViews);
          setTotalUnique(data.totalUnique);
          setChartData(data.chartData);
          if (data.templates) {
            setTemplates(data.templates);
          }
        }
        setLoading(false);
      })
      .catch((err) => {
        console.error("Error loading analytics:", err);
        setLoading(false);
      });
  }, [filterType, selectedTemplateId]);

  const templateOptions = useMemo(() => {
    const list = [{ label: "All Templates", value: "all" }];
    templates.forEach((t) => {
      list.push({ label: t.name, value: t.id });
    });
    return list;
  }, [templates]);

  // Graph plotting variables
  const width = 700;
  const height = 240;
  const paddingLeft = 55;
  const paddingRight = 30;
  const paddingTop = 25;
  const paddingBottom = 40;

  const graphWidth = width - paddingLeft - paddingRight;
  const graphHeight = height - paddingTop - paddingBottom;

  const maxVal = useMemo(() => {
    if (chartData.length === 0) return 5;
    const peak = Math.max(...chartData.map((d) => d.views), ...chartData.map((d) => d.uniqueVisitors));
    return peak === 0 ? 5 : Math.ceil(peak * 1.15); // Add a small margin overhead
  }, [chartData]);

  // Generate SVG elements
  const { pathD, areaD, points, visitorPoints, visitorPathD } = useMemo(() => {
    if (chartData.length === 0) {
      return { pathD: "", areaD: "", points: [], visitorPoints: [], visitorPathD: "" };
    }

    const pts: Array<{ x: number; y: number; val: number }> = [];
    const vPts: Array<{ x: number; y: number; val: number }> = [];

    chartData.forEach((day, index) => {
      const x = paddingLeft + (index / (chartData.length - 1)) * graphWidth;
      const y = paddingTop + graphHeight - (day.views / maxVal) * graphHeight;
      const vy = paddingTop + graphHeight - (day.uniqueVisitors / maxVal) * graphHeight;

      pts.push({ x, y, val: day.views });
      vPts.push({ x, y: vy, val: day.uniqueVisitors });
    });

    const pD = pts.map((p, idx) => `${idx === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
    const vpD = vPts.map((p, idx) => `${idx === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");

    const aD = pD
      ? `${pD} L ${paddingLeft + graphWidth} ${paddingTop + graphHeight} L ${paddingLeft} ${paddingTop + graphHeight} Z`
      : "";

    return { pathD: pD, areaD: aD, points: pts, visitorPoints: vPts, visitorPathD: vpD };
  }, [chartData, maxVal, graphWidth, graphHeight]);

  return (
    <>
      {/* Welcome Banner */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <h1 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "2.1rem", fontWeight: 800, color: "#f0f2ff", letterSpacing: "-0.025em" }}>
            Welcome back, {userName}!
          </h1>
          <p style={{ fontSize: "0.875rem", color: "rgba(240,242,255,0.45)", marginTop: "0.35rem" }}>
            Here is what's happening on your visual builder platform workspace.
          </p>
        </div>
        <span style={{
          fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.08em",
          textTransform: "uppercase", color: "var(--brand)",
          background: "var(--brand-subtle)", padding: "0.35rem 0.75rem", borderRadius: 8,
          border: "1px solid rgba(139,92,246,0.15)"
        }}>
          {plan} ACCOUNT
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2rem", marginBottom: "2.5rem", width: "100%" }} className="overview-top-row">
        {/* Onboarding Checklist Card */}
        <div style={{
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: 16, padding: "1.75rem",
          boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
          display: "flex", flexDirection: "column", gap: "1.5rem"
        }}>
          <div>
            <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "#f0f2ff", margin: 0 }}>
              Onboarding Checklist
            </h2>
            <p style={{ fontSize: "0.8rem", color: "rgba(240,242,255,0.4)", margin: "0.25rem 0 0" }}>
              Follow these simple steps to deploy your landing pages.
            </p>
          </div>

          {/* Progress Bar */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.78rem", fontWeight: 650, color: "#f0f2ff", marginBottom: "0.5rem" }}>
              <span>Workspace Setup Progress</span>
              <span style={{ color: "var(--brand)" }}>{onboardingPercentage}%</span>
            </div>
            <div style={{ width: "100%", height: 6, background: "rgba(255,255,255,0.04)", borderRadius: 999, overflow: "hidden" }}>
              <div style={{ width: `${onboardingPercentage}%`, height: "100%", background: "linear-gradient(90deg, var(--brand), #a78bfa)", borderRadius: 999, transition: "width 0.5s ease" }} />
            </div>
          </div>

          {/* Steps List */}
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {steps.map((step) => (
              <div key={step.id} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "0.75rem 1rem", borderRadius: 10,
                background: step.done ? "rgba(16,185,129,0.03)" : "rgba(255,255,255,0.01)",
                border: step.done ? "1px solid rgba(16,185,129,0.1)" : "1px solid rgba(255,255,255,0.04)",
                fontSize: "0.82rem"
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                  <div style={{
                    width: 20, height: 20, borderRadius: "50%",
                    background: step.done ? "rgba(16,185,129,0.1)" : "rgba(255,255,255,0.03)",
                    border: step.done ? "1px solid rgba(16,185,129,0.15)" : "1px solid rgba(255,255,255,0.06)",
                    display: "grid", placeItems: "center", fontSize: "0.68rem"
                  }}>
                    {step.done ? "✓" : ""}
                  </div>
                  <span style={{ color: step.done ? "rgba(240,242,255,0.75)" : "rgba(240,242,255,0.45)", fontWeight: step.done ? 600 : 400 }}>
                    {step.label}
                  </span>
                </div>
                {step.done ? (
                  <span style={{ color: "#34d399", fontWeight: 700, fontSize: "0.75rem" }}>
                    Completed
                  </span>
                ) : step.link ? (
                  <Link href={step.link} style={{ color: "var(--brand)", textDecoration: "none", fontWeight: 700, fontSize: "0.75rem" }}>
                    {step.linkText}
                  </Link>
                ) : (
                  <span style={{ color: "rgba(240,242,255,0.25)", fontSize: "0.72rem", fontStyle: "italic" }}>
                    {step.statusText}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Plexo Core Capabilities Card */}
        <div style={{
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: 16, padding: "1.75rem",
          boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
          display: "flex", flexDirection: "column", gap: "1.25rem"
        }}>
          <div>
            <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "#f0f2ff", margin: 0 }}>
              Plexo Core Features
            </h2>
            <p style={{ fontSize: "0.8rem", color: "rgba(240,242,255,0.4)", margin: "0.25rem 0 0" }}>
              Explore the advanced features integrated inside your workspace.
            </p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", flex: 1 }}>
            {[
              { icon: "🎨", title: "Visual Editor", desc: "Drag-and-drop landing page elements & styles." },
              { icon: "⚡", title: "AI Generation", desc: "Automate builder style structures & typography." },
              { icon: "🌐", title: "Custom Mapping", desc: "Link subdomains & root custom domains." },
              { icon: "📈", title: "Analytics Tracker", desc: "Privacy-focused visit logging & metrics." }
            ].map((cap, i) => (
              <div key={i} style={{
                background: "rgba(255,255,255,0.01)", border: "1px solid rgba(255,255,255,0.03)",
                borderRadius: 12, padding: "1rem", display: "flex", flexDirection: "column", gap: "0.4rem"
              }}>
                <span style={{ fontSize: "1.3rem" }}>{cap.icon}</span>
                <h4 style={{ fontSize: "0.85rem", fontWeight: 700, color: "#f0f2ff", margin: 0 }}>{cap.title}</h4>
                <p style={{ fontSize: "0.72rem", color: "rgba(240,242,255,0.4)", margin: 0, lineHeight: 1.4 }}>{cap.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Analytics Graph & Timeline Dashboard */}
      <div style={{
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: 16, padding: "1.75rem",
        boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
        marginBottom: "2rem"
      }}>
        {/* Filters and Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem", borderBottom: "1px solid rgba(255,255,255,0.05)", paddingBottom: "1.25rem", flexWrap: "wrap", gap: "1.25rem" }}>
          <div>
            <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "#f0f2ff", margin: 0 }}>
              Visitor Insights Graph
            </h2>
            <p style={{ fontSize: "0.8rem", color: "rgba(240,242,255,0.4)", margin: "0.25rem 0 0" }}>
              Total views and unique visits mapped over the last 7 days.
            </p>
          </div>

          {/* Filtering controls */}
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
            <div style={{ display: "flex", background: "rgba(255,255,255,0.03)", padding: 4, borderRadius: 10, border: "1px solid rgba(255,255,255,0.06)" }}>
              <button
                type="button"
                onClick={() => { setFilterType("all"); setSelectedTemplateId("all"); }}
                style={{
                  padding: "0.35rem 0.75rem", borderRadius: 8, fontSize: "0.78rem", border: "none", fontWeight: 650,
                  background: filterType === "all" && selectedTemplateId === "all" ? "var(--brand)" : "transparent",
                  color: filterType === "all" && selectedTemplateId === "all" ? "#fff" : "rgba(240,242,255,0.45)",
                  cursor: "pointer", transition: "all 0.15s"
                }}
              >
                All Pages
              </button>
              <button
                type="button"
                onClick={() => { setFilterType("published"); setSelectedTemplateId("all"); }}
                style={{
                  padding: "0.35rem 0.75rem", borderRadius: 8, fontSize: "0.78rem", border: "none", fontWeight: 650,
                  background: filterType === "published" && selectedTemplateId === "all" ? "var(--brand)" : "transparent",
                  color: filterType === "published" && selectedTemplateId === "all" ? "#fff" : "rgba(240,242,255,0.45)",
                  cursor: "pointer", transition: "all 0.15s"
                }}
              >
                Published Only
              </button>
            </div>

            {/* Template filter list */}
            {templates.length > 0 && (
              <div style={{ width: 180 }}>
                <CustomSelect
                  value={selectedTemplateId}
                  options={templateOptions}
                  onChange={(val) => {
                    setSelectedTemplateId(val);
                    if (val !== "all") setFilterType("all");
                  }}
                />
              </div>
            )}
          </div>
        </div>

        {loading ? (
          <div style={{ height: 260, display: "grid", placeItems: "center" }}>
            <div className="spinner" style={{ width: 32, height: 32, borderWidth: 3 }} />
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: "2rem" }} className="analytics-layout-split">
            {/* Stat indicators card */}
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem", justifyContent: "center" }}>
              <div style={{
                background: "rgba(255,255,255,0.01)", border: "1px solid rgba(255,255,255,0.04)",
                borderRadius: 12, padding: "1.25rem"
              }}>
                <span style={{ fontSize: "0.68rem", fontWeight: 700, color: "rgba(240,242,255,0.3)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  Total Page Views
                </span>
                <h3 style={{ fontSize: "2rem", fontWeight: 800, color: "#f0f2ff", margin: "0.35rem 0 0" }}>
                  {totalViews}
                </h3>
              </div>

              <div style={{
                background: "rgba(255,255,255,0.01)", border: "1px solid rgba(255,255,255,0.04)",
                borderRadius: 12, padding: "1.25rem"
              }}>
                <span style={{ fontSize: "0.68rem", fontWeight: 700, color: "rgba(240,242,255,0.3)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  Unique Visitors
                </span>
                <h3 style={{ fontSize: "2rem", fontWeight: 800, color: "var(--brand)", margin: "0.35rem 0 0" }}>
                  {totalUnique}
                </h3>
              </div>
            </div>

            {/* SVG Visual Graph */}
            <div style={{ width: "100%", overflowX: "auto" }}>
              <div style={{ minWidth: 650 }}>
                <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
                  <defs>
                    <linearGradient id="viewsAreaGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.18" />
                      <stop offset="100%" stopColor="var(--brand)" stopOpacity="0.0" />
                    </linearGradient>
                  </defs>

                  {/* Horizontal grid lines */}
                  {[0, 0.5, 1].map((ratio, i) => {
                    const y = paddingTop + ratio * graphHeight;
                    const val = Math.round(maxVal - ratio * maxVal);
                    return (
                      <g key={i}>
                        <line
                          x1={paddingLeft}
                          y1={y}
                          x2={width - paddingRight}
                          y2={y}
                          stroke="rgba(255,255,255,0.04)"
                          strokeWidth="1"
                          strokeDasharray="4 4"
                        />
                        <text
                          x={paddingLeft - 10}
                          y={y + 4}
                          fill="rgba(240,242,255,0.25)"
                          fontSize="10"
                          fontFamily="monospace"
                          textAnchor="end"
                        >
                          {val}
                        </text>
                      </g>
                    );
                  })}

                  {/* Area fill under graph path */}
                  {areaD && (
                    <path
                      d={areaD}
                      fill="url(#viewsAreaGrad)"
                    />
                  )}

                  {/* Line path for Total views */}
                  {pathD && (
                    <path
                      d={pathD}
                      fill="none"
                      stroke="var(--brand)"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  )}

                  {/* Line path for Unique visitors */}
                  {visitorPathD && (
                    <path
                      d={visitorPathD}
                      fill="none"
                      stroke="#10b981"
                      strokeWidth="1.8"
                      strokeDasharray="3 3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  )}

                  {/* Points / Hover markers */}
                  {points.map((p, idx) => (
                    <g key={idx}>
                      <circle
                        cx={p.x}
                        cy={p.y}
                        r="3.5"
                        fill="#0b0f19"
                        stroke="var(--brand)"
                        strokeWidth="2.5"
                      />
                      <text
                        x={p.x}
                        y={p.y - 8}
                        fill="#f0f2ff"
                        fontSize="9"
                        fontWeight="700"
                        fontFamily="monospace"
                        textAnchor="middle"
                        style={{ display: p.val === 0 ? "none" : "block" }}
                      >
                        {p.val}
                      </text>
                    </g>
                  ))}

                  {/* Date labels for x-axis */}
                  {chartData.map((day, index) => {
                    const x = paddingLeft + (index / (chartData.length - 1)) * graphWidth;
                    return (
                      <text
                        key={index}
                        x={x}
                        y={height - 15}
                        fill="rgba(240,242,255,0.3)"
                        fontSize="10.5"
                        fontWeight={550}
                        textAnchor="middle"
                      >
                        {day.date}
                      </text>
                    );
                  })}
                </svg>

                {/* Graph Legend */}
                <div style={{ display: "flex", gap: "1.5rem", justifyContent: "center", marginTop: "0.25rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.78rem" }}>
                    <div style={{ width: 12, height: 3, background: "var(--brand)", borderRadius: 2 }} />
                    <span style={{ color: "rgba(240,242,255,0.55)" }}>Total Page Views</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.78rem" }}>
                    <div style={{ width: 12, height: 3, borderTop: "2px dashed #10b981" }} />
                    <span style={{ color: "rgba(240,242,255,0.55)" }}>Unique Visitors</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <style jsx>{`
        .spinner {
          border: 2px solid rgba(255,255,255,0.06);
          border-top-color: var(--brand);
          border-radius: 50%;
          animation: spin 0.65s linear infinite;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @media (max-width: 900px) {
          .overview-top-row {
            grid-template-columns: 1fr !important;
          }
          .analytics-layout-split {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </>
  );
}
