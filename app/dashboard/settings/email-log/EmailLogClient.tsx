"use client";

import { useMemo, useState } from "react";
import { Badge, Card, EmptyState, Notice, SegmentedControl } from "@/app/dashboard/_v3/ui";
import { emailLabel, failureHelp, summarizeEmails } from "@/lib/mail/emailLabels";

type EmailLogRow = { id: string; to: string; subject: string; context: string; status: "sent" | "failed"; errorMessage?: string; createdAt: string };
type Filter = "all" | "sent" | "failed";

const when = (iso: string) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "");

/** Every email Plexo sent for the workspace lately: how many got out, which ones didn't, and what to do about it. */
export function EmailLogClient({ logs }: { logs: EmailLogRow[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const stats = useMemo(() => summarizeEmails(logs), [logs]);
  const visible = filter === "all" ? logs : logs.filter((l) => l.status === filter);

  return (
    <div data-plexo-v3 style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }} data-testid="email-log">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 160px), 1fr))", gap: 12 }}>
        {[
          { label: "Sent this week", value: stats.last7 - stats.failed7 },
          { label: "Didn't get through", value: stats.failed7, warn: stats.failed7 > 0 },
          { label: "Shown below", value: stats.total },
        ].map((s) => (
          <div key={s.label} style={{ border: "1px solid var(--plx-border)", background: "var(--plx-surface)", borderRadius: 14, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ color: "var(--plx-muted)", fontSize: 13, fontWeight: 700 }}>{s.label}</span>
            <b style={{ fontSize: 26, color: s.warn ? "var(--plx-danger)" : "var(--plx-text)" }}>{s.value}</b>
          </div>
        ))}
      </div>

      {stats.failed7 > 0 ? <Notice kind="warning" title={`${stats.failed7} ${stats.failed7 === 1 ? "email" : "emails"} didn't get through this week`}>Open the ones marked &ldquo;Didn&apos;t send&rdquo; to see why and what to do.</Notice> : null}

      <SegmentedControl label="Show" options={[{ value: "all", label: "All" }, { value: "sent", label: `Sent${stats.sent ? ` (${stats.sent})` : ""}` }, { value: "failed", label: `Didn't send${stats.failed ? ` (${stats.failed})` : ""}` }]} value={filter} onChange={setFilter} />

      {visible.length === 0 ? (
        <Card><EmptyState compact title={logs.length ? "Nothing here" : "No emails yet"} body={logs.length ? "No emails match this view." : "When Plexo sends an email for you, like a form reply or an order receipt, it appears here. We keep about six months."} /></Card>
      ) : (
        <Card padding="none">
          {visible.map((l) => (
            <div key={l.id} style={{ padding: "14px 18px", borderBottom: "1px solid var(--plx-border)", display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
                <b style={{ fontSize: 15 }}>{emailLabel(l.context)}</b>
                <Badge tone={l.status === "sent" ? "success" : "danger"}>{l.status === "sent" ? "Sent" : "Didn't send"}</Badge>
              </div>
              <span style={{ color: "var(--plx-text)", fontSize: 14, overflowWrap: "anywhere" }}>To {l.to}</span>
              <span style={{ color: "var(--plx-muted)", fontSize: 13.5, overflowWrap: "anywhere" }}>{l.subject}</span>
              <span style={{ color: "var(--plx-faint)", fontSize: 12.5 }}>{when(l.createdAt)}</span>
              {l.status === "failed" ? (
                <details style={{ marginTop: 4 }}>
                  <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: 13.5 }}>Why didn&apos;t it send?</summary>
                  <p style={{ margin: "6px 0 0", fontSize: 14 }}>{failureHelp(l.errorMessage)}</p>
                  {l.errorMessage ? <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "var(--plx-faint)", overflowWrap: "anywhere" }}>Technical note: {l.errorMessage}</p> : null}
                </details>
              ) : null}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
