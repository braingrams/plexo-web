"use client";

import { useMemo, useState } from "react";
import { Card } from "@/app/dashboard/_components/Card";

type EmailLogRow = {
  id: string;
  to: string;
  subject: string;
  context: string;
  status: "sent" | "failed";
  errorMessage?: string;
  createdAt: string;
};

type Filter = "ALL" | "sent" | "failed";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "sent", label: "Sent" },
  { value: "failed", label: "Failed" },
];

const STATUS_COLORS: Record<"sent" | "failed", { bg: string; color: string }> = {
  sent: { bg: "color-mix(in srgb, var(--plx-success, rgb(34 197 94)) 15%, transparent)", color: "var(--plx-success, #4ade80)" },
  failed: { bg: "color-mix(in srgb, var(--plx-danger, rgb(239 68 68)) 12%, transparent)", color: "var(--plx-danger, #f87171)" },
};

function formatContext(context: string): string {
  return context.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDateTime(date: string): string {
  if (!date) return "—";
  return new Date(date).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function EmailLogClient({ logs }: { logs: EmailLogRow[] }) {
  const [filter, setFilter] = useState<Filter>("ALL");

  const counts = useMemo(
    () => logs.reduce<Record<string, number>>((acc, l) => { acc[l.status] = (acc[l.status] ?? 0) + 1; return acc; }, {}),
    [logs],
  );
  const visible = filter === "ALL" ? logs : logs.filter((l) => l.status === filter);

  return (
    <div>
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.25rem", flexWrap: "wrap" }}>
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFilter(f.value)}
            style={{
              padding: "0.4rem 0.9rem", borderRadius: 8, border: "1px solid color-mix(in srgb, var(--plx-text, #fff) 12%, transparent)", cursor: "pointer",
              fontSize: "0.8rem", fontWeight: 700,
              background: filter === f.value ? "var(--brand-subtle)" : "transparent",
              color: filter === f.value ? "var(--plx-link, var(--brand))" : "color-mix(in srgb, var(--plx-text, rgb(240 242 255)) 60%, transparent)",
            }}
          >
            {f.label}
            {f.value !== "ALL" && counts[f.value] ? ` (${counts[f.value]})` : ""}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <Card style={{ padding: "3rem 2rem", textAlign: "center" }}>
          <p style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--plx-muted, rgba(240,242,255,0.7))" }}>No email log entries</p>
          <p style={{ fontSize: "0.8rem", color: "var(--plx-muted, rgba(240,242,255,0.4))", marginTop: "0.3rem" }}>
            {filter === "ALL" ? "Nothing has been sent for this organization yet." : `No ${filter} sends yet.`}
          </p>
        </Card>
      ) : (
        <Card padded={false} style={{ overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid color-mix(in srgb, var(--plx-text, #fff) 8%, transparent)" }}>
                  {["To", "Subject", "Context", "Status", "Sent At"].map((h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: "left", padding: "0.8rem 1.1rem", fontSize: "0.68rem", fontWeight: 700,
                        letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--plx-muted, rgba(240,242,255,0.4))",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((log) => (
                  <tr key={log.id} style={{ borderBottom: "1px solid color-mix(in srgb, var(--plx-text, #fff) 5%, transparent)" }}>
                    <td style={{ padding: "0.75rem 1.1rem", color: "var(--plx-text, #f0f2ff)", whiteSpace: "nowrap" }}>{log.to}</td>
                    <td style={{ padding: "0.75rem 1.1rem", color: "var(--plx-text, rgba(240,242,255,0.75))", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={log.subject}>
                      {log.subject}
                    </td>
                    <td style={{ padding: "0.75rem 1.1rem", color: "var(--plx-muted, rgba(240,242,255,0.55))", whiteSpace: "nowrap" }}>{formatContext(log.context)}</td>
                    <td style={{ padding: "0.75rem 1.1rem", whiteSpace: "nowrap" }}>
                      <span
                        style={{
                          display: "inline-flex", alignItems: "center", padding: "0.2rem 0.6rem", borderRadius: 999,
                          fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase",
                          background: STATUS_COLORS[log.status].bg, color: STATUS_COLORS[log.status].color,
                        }}
                        title={log.status === "failed" ? log.errorMessage : undefined}
                      >
                        {log.status}
                      </span>
                    </td>
                    <td style={{ padding: "0.75rem 1.1rem", color: "var(--plx-muted, rgba(240,242,255,0.45))", whiteSpace: "nowrap" }}>{formatDateTime(log.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
