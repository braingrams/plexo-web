"use client";

import { useMemo } from "react";

export type TimelineDay = {
  date: string;
  views: number;
  uniqueVisitors: number;
};

/**
 * Real SVG line chart of views + unique visitors over time — extracted from
 * app/dashboard/insights/insights-client.tsx so the main Overview page can embed the same
 * live chart instead of a bare number, without duplicating the drawing logic. Insights
 * keeps its own filters/stat cards/heatmap around this; this component only owns the plot.
 */
export function TrafficChart({ chartData, height = 240 }: { chartData: TimelineDay[]; height?: number }) {
  const width = 700;
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

  const { pathD, areaD, points, visitorPathD } = useMemo(() => {
    if (chartData.length === 0) {
      return { pathD: "", areaD: "", points: [] as Array<{ x: number; y: number; val: number }>, visitorPathD: "" };
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

    return { pathD: pD, areaD: aD, points: pts, visitorPathD: vpD };
  }, [chartData, maxVal, graphWidth, graphHeight]);

  return (
    <div style={{ width: "100%", overflowX: "auto" }}>
      <div style={{ minWidth: 650 }}>
        <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
          <defs>
            <linearGradient id="trafficChartAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.18" />
              <stop offset="100%" stopColor="var(--brand)" stopOpacity="0.0" />
            </linearGradient>
          </defs>

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
                <text x={paddingLeft - 10} y={y + 4} fill="rgba(240,242,255,0.25)" fontSize="10" fontFamily="monospace" textAnchor="end">
                  {val}
                </text>
              </g>
            );
          })}

          {areaD && <path d={areaD} fill="url(#trafficChartAreaGrad)" />}

          {pathD && (
            <path d={pathD} fill="none" stroke="var(--brand)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          )}

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

          {points.map((p, idx) => (
            <g key={idx}>
              <circle cx={p.x} cy={p.y} r="3.5" fill="#0b0f19" stroke="var(--brand)" strokeWidth="2.5" />
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

          {chartData.map((day, index) => {
            const x = paddingLeft + (index / (chartData.length - 1)) * graphWidth;
            return (
              <text key={index} x={x} y={height - 15} fill="rgba(240,242,255,0.3)" fontSize="10.5" fontWeight={550} textAnchor="middle">
                {day.date}
              </text>
            );
          })}
        </svg>

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
  );
}
