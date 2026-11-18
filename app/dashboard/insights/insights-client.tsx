"use client";

import { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { CustomSelect } from "../../_components/CustomSelect";
import { Card } from "../_components/Card";
import { PageHeader } from "../_components/PageHeader";
import { ActivityHeatmap, type HeatmapPoint } from "../_components/ActivityHeatmap";
import { VisitorDetailsModal } from "../_components/VisitorDetailsModal";
import { TrafficChart } from "../_components/TrafficChart";
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

export function InsightsClient({ v3 = false }: { v3?: boolean }) {
  const searchParams = useSearchParams();

  // Analytics Filter States. Deep-linked from a site's own Detail page ("View full
  // analytics") — a ?templateId= param pre-selects that site instead of leaving the
  // visitor to find it themselves in the dropdown.
  const [filterType, setFilterType] = useState<"all" | "published">("all");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(() => searchParams.get("templateId") || "all");
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
    const list = [{ label: v3 ? "All my sites" : "All Templates", value: "all" }];
    templates.forEach((t) => {
      list.push({ label: t.name, value: t.id });
    });
    return list;
  }, [templates]);

  return (
    <>
      <PageHeader
        eyebrow={v3 ? undefined : "Workspace"}
        title={v3 ? "Visits" : "Insights"}
        subtitle={v3 ? "How many people are looking at your sites, and when." : "Traffic and engagement across your published landing pages."}
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
              <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--cmx-text, #f0f2ff)", margin: 0 }}>
                Activity by Time
              </h2>
              <p style={{ fontSize: "0.8rem", color: "var(--cmx-muted, rgba(240,242,255,0.4))", margin: "0.25rem 0 0" }}>
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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.5rem", borderBottom: "1px solid color-mix(in srgb, var(--cmx-ink, rgb(255,255,255)) 5%, transparent)", paddingBottom: "1.25rem", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--cmx-text, #f0f2ff)", margin: 0 }}>
              {v3 ? "Visits day by day" : "Visitor Insights Graph"}
            </h2>
            <p style={{ fontSize: "0.8rem", color: "var(--cmx-muted, rgba(240,242,255,0.4))", margin: "0.25rem 0 0" }}>
              {v3 ? "Every look at your sites, and how many different people, over the last 7 days." : "Total views and unique visits mapped over the last 7 days."}
            </p>
          </div>

          {/* Filtering controls */}
          <div className="insights-filter-controls" style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ display: "flex", background: "color-mix(in srgb, var(--cmx-ink, rgb(255,255,255)) 3%, transparent)", padding: 4, borderRadius: 10, border: "1px solid color-mix(in srgb, var(--cmx-ink, rgb(255,255,255)) 6%, transparent)" }}>
              <button
                type="button"
                onClick={() => { setFilterType("all"); setSelectedTemplateId("all"); }}
                style={{
                  padding: "0.35rem 0.75rem", borderRadius: 8, fontSize: "0.78rem", border: "none", fontWeight: 650,
                  background: filterType === "all" && selectedTemplateId === "all" ? "var(--cmx-brand, var(--brand))" : "transparent",
                  color: filterType === "all" && selectedTemplateId === "all" ? "var(--cmx-on-brand, #fff)" : "var(--cmx-muted, rgba(240,242,255,0.45))",
                  cursor: "pointer", transition: "all 0.15s"
                }}
              >
                {v3 ? "All my sites" : "All Pages"}
              </button>
              <button
                type="button"
                onClick={() => { setFilterType("published"); setSelectedTemplateId("all"); }}
                style={{
                  padding: "0.35rem 0.75rem", borderRadius: 8, fontSize: "0.78rem", border: "none", fontWeight: 650,
                  background: filterType === "published" && selectedTemplateId === "all" ? "var(--cmx-brand, var(--brand))" : "transparent",
                  color: filterType === "published" && selectedTemplateId === "all" ? "var(--cmx-on-brand, #fff)" : "var(--cmx-muted, rgba(240,242,255,0.45))",
                  cursor: "pointer", transition: "all 0.15s"
                }}
              >
                {v3 ? "Live sites only" : "Published Only"}
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
                background: "color-mix(in srgb, var(--cmx-brand, rgb(var(--brand-rgb))) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--cmx-brand, rgb(var(--brand-rgb))) 25%, transparent)",
                color: totalViews === 0 ? "var(--cmx-muted, rgba(240,242,255,0.25))" : "var(--cmx-violet, #c4b5fd)",
                cursor: totalViews === 0 ? "not-allowed" : "pointer", whiteSpace: "nowrap",
              }}
            >
              {v3 ? "See who visited" : "View Details"}
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
                background: "color-mix(in srgb, var(--cmx-ink, rgb(255,255,255)) 1%, transparent)", border: "1px solid color-mix(in srgb, var(--cmx-ink, rgb(255,255,255)) 4%, transparent)",
                borderRadius: 12, padding: "1.25rem"
              }}>
                <span style={{ fontSize: "0.68rem", fontWeight: 700, color: "var(--cmx-muted, rgba(240,242,255,0.3))", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  {v3 ? "Times your sites were opened" : "Total Page Views"}
                </span>
                <h3 style={{ fontSize: "2rem", fontWeight: 800, color: "var(--cmx-text, #f0f2ff)", margin: "0.35rem 0 0" }}>
                  {totalViews}
                </h3>
              </div>

              <div style={{
                background: "color-mix(in srgb, var(--cmx-ink, rgb(255,255,255)) 1%, transparent)", border: "1px solid color-mix(in srgb, var(--cmx-ink, rgb(255,255,255)) 4%, transparent)",
                borderRadius: 12, padding: "1.25rem"
              }}>
                <span style={{ fontSize: "0.68rem", fontWeight: 700, color: "var(--cmx-muted, rgba(240,242,255,0.3))", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  {v3 ? "Different people" : "Unique Visitors"}
                </span>
                <h3 style={{ fontSize: "2rem", fontWeight: 800, color: "var(--cmx-accent, var(--brand))", margin: "0.35rem 0 0" }}>
                  {totalUnique}
                </h3>
              </div>
            </div>

            <TrafficChart chartData={chartData} height={240} />
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
          border: 2px solid color-mix(in srgb, var(--cmx-ink, rgb(255,255,255)) 6%, transparent);
          border-top-color: var(--cmx-brand, var(--brand));
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
