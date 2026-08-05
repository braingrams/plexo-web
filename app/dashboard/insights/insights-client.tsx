"use client";

import { useState, useEffect, useMemo } from "react";
import { CustomSelect } from "../domains/domains-client";
import { Card } from "../_components/Card";
import { PageHeader } from "../_components/PageHeader";
import { ActivityHeatmap, type HeatmapPoint } from "../_components/ActivityHeatmap";
import { VisitorDetailsModal } from "../_components/VisitorDetailsModal";
import { useLayoutMode } from "../layout-mode-context";

type TimelineDay = {
  date: string;
  views: number;
  uniqueVisitors: number;
};

type TemplateItem = {
  id: string;
  name: string;
};

export function InsightsClient() {
  // Analytics Filter States
  const [filterType, setFilterType] = useState<"all" | "published">("all");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [detailsOpen, setDetailsOpen] = useState(false);

  // Data from API
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [totalViews, setTotalViews] = useState(0);
  const [totalUnique, setTotalUnique] = useState(0);
  const [chartData, setChartData] = useState<TimelineDay[]>([]);
  const [heatmapData, setHeatmapData] = useState<HeatmapPoint[]>([]);

  const { mode } = useLayoutMode();
  const isModern = mode === "MODERN";

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
          setHeatmapData(data.heatmap ?? []);
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
      <PageHeader
        eyebrow="Workspace"
        title="Insights"
        subtitle="Traffic and engagement across your published landing pages."
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: "1.5rem",
          marginBottom: "2rem",
          width: "100%",
        }}
        className="insights-top-row"
      >
        {/* Activity Heatmap — Modern layout only */}
        {isModern && (
          <Card style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            <div>
              <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "#f0f2ff", margin: 0 }}>
                Activity by Time
              </h2>
              <p style={{ fontSize: "0.8rem", color: "rgba(240,242,255,0.4)", margin: "0.25rem 0 0" }}>
                When your visitors show up, over the last 7 days.
              </p>
            </div>
            <ActivityHeatmap data={heatmapData} />
          </Card>
        )}
      </div>

      {/* Analytics Graph & Timeline Dashboard */}
      <Card style={{ marginBottom: "2rem" }}>
        {/* Filters and Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.5rem", borderBottom: "1px solid rgba(255,255,255,0.05)", paddingBottom: "1.25rem", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "#f0f2ff", margin: 0 }}>
              Visitor Insights Graph
            </h2>
            <p style={{ fontSize: "0.8rem", color: "rgba(240,242,255,0.4)", margin: "0.25rem 0 0" }}>
              Total views and unique visits mapped over the last 7 days.
            </p>
          </div>

          {/* Filtering controls */}
          <div className="insights-filter-controls" style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
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
              <div style={{ width: "min(180px, 100%)" }}>
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

            <button
              type="button"
              onClick={() => setDetailsOpen(true)}
              disabled={totalViews === 0}
              style={{
                padding: "0.5rem 0.9rem", borderRadius: 10, fontSize: "0.78rem", fontWeight: 650,
                background: "rgba(139,92,246,0.1)", border: "1px solid rgba(139,92,246,0.25)",
                color: totalViews === 0 ? "rgba(240,242,255,0.25)" : "#c4b5fd",
                cursor: totalViews === 0 ? "not-allowed" : "pointer", whiteSpace: "nowrap",
              }}
            >
              View Details
            </button>
          </div>
        </div>

        {loading ? (
          <div style={{ height: 260, display: "grid", placeItems: "center" }}>
            <div className="spinner" style={{ width: 32, height: 32, borderWidth: 3 }} />
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: "2rem" }} className="insights-layout-split">
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
      </Card>

      <VisitorDetailsModal
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        templateId={selectedTemplateId}
        filterType={filterType}
      />

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
          .insights-top-row {
            grid-template-columns: 1fr !important;
          }
          .insights-layout-split {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </>
  );
}
