"use client";

import { Fragment, useMemo } from "react";

export type HeatmapPoint = { day: number; hour: number; count: number };

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const BAND_SIZE_HOURS = 4;
const BAND_LABELS = ["12am", "4am", "8am", "12pm", "4pm", "8pm"];

/** Day x time-of-day activity grid, backed by real page-view timestamps from /api/v1/analytics. */
export function ActivityHeatmap({ data }: { data: HeatmapPoint[] }) {
  const { grid, max } = useMemo(() => {
    const cells: number[][] = Array.from({ length: BAND_LABELS.length }, () => Array(7).fill(0));
    data.forEach((point) => {
      const band = Math.min(Math.floor(point.hour / BAND_SIZE_HOURS), BAND_LABELS.length - 1);
      if (point.day >= 0 && point.day <= 6) {
        cells[band][point.day] += point.count;
      }
    });
    const peak = Math.max(1, ...cells.flat());
    return { grid: cells, max: peak };
  }, [data]);

  const hasData = data.some((d) => d.count > 0);

  function cellColor(value: number): string {
    if (value === 0) return "rgba(255,255,255,0.035)";
    const ratio = value / max;
    return `rgba(139, 92, 246, ${0.15 + ratio * 0.75})`;
  }

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "44px repeat(7, 1fr)", gap: 5 }}>
        <div />
        {DAY_LABELS.map((label) => (
          <div
            key={label}
            style={{ textAlign: "center", fontSize: "0.68rem", fontWeight: 600, color: "rgba(240,242,255,0.35)" }}
          >
            {label}
          </div>
        ))}
        {grid.map((row, bandIdx) => (
          <Fragment key={bandIdx}>
            <div style={{ fontSize: "0.66rem", color: "rgba(240,242,255,0.3)", display: "flex", alignItems: "center" }}>
              {BAND_LABELS[bandIdx]}
            </div>
            {row.map((value, dayIdx) => (
              <div
                key={dayIdx}
                title={`${DAY_LABELS[dayIdx]} ${BAND_LABELS[bandIdx]}: ${value} view${value === 1 ? "" : "s"}`}
                style={{ aspectRatio: "1", borderRadius: 5, background: cellColor(value), transition: "background 0.15s" }}
              />
            ))}
          </Fragment>
        ))}
      </div>

      {!hasData && (
        <p style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.3)", marginTop: "1rem", textAlign: "center" }}>
          No visits yet — activity will appear here once your pages get traffic.
        </p>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "0.4rem", marginTop: "0.9rem" }}>
        <span style={{ fontSize: "0.68rem", color: "rgba(240,242,255,0.3)" }}>Less</span>
        {[0.1, 0.3, 0.5, 0.75, 1].map((ratio) => (
          <div key={ratio} style={{ width: 11, height: 11, borderRadius: 3, background: `rgba(139,92,246,${0.12 + ratio * 0.7})` }} />
        ))}
        <span style={{ fontSize: "0.68rem", color: "rgba(240,242,255,0.3)" }}>More</span>
      </div>
    </div>
  );
}
