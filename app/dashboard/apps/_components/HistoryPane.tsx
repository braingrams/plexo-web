"use client";

import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import { Bot, CalendarClock, Code2, Eye, FileText, Flag, GitMerge, Hammer, History, Rocket, RotateCcw, Undo2 } from "lucide-react";
import { appsApi, ApiError, type BuildReport } from "./api";
import { C, Button, Notice, PaneHeader, StateStyles, Shimmer, ListSkeleton, ProblemState, EmptyHero, StatCard, Pill, timeAgo } from "./ui";

// Every version of the app (each SOL turn, code edit, publish, go-back, import) with one-click
// go-back, plus the log of every preview refresh and publish.

type Version = Awaited<ReturnType<typeof appsApi.versions>>["versions"][number];
type BuildRow = Awaited<ReturnType<typeof appsApi.builds>>["builds"][number];
type IconType = ComponentType<{ size?: number }>;

// Who or what made each version, in the owner's words — each with its own colour on the timeline.
const SOURCE: Record<string, { label: string; color: string; icon: IconType }> = {
  ai: { label: "SOL", color: "var(--ed-accent-text)", icon: Bot },
  editor: { label: "Code edit", color: "var(--ed-violet)", icon: Code2 },
  deploy: { label: "Published", color: "var(--brand-deep)", icon: Rocket },
  restore: { label: "Went back", color: "var(--brand-light)", icon: Undo2 },
  scaffold: { label: "App created", color: "var(--brand-soft)", icon: Flag },
  git: { label: "Imported", color: "var(--brand-deeper)", icon: GitMerge },
};
const sourceOf = (s: string) => SOURCE[s] ?? { label: "Saved", color: "var(--ed-lavender)", icon: History };

/** "Today", "Yesterday", or a friendly date — the timeline's section labels. */
function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(today) - startOf(d)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

// Server messages are kept only when they're already written for people; anything else becomes plain words.
const plainError = (err: unknown, fallback: string) => (err instanceof ApiError && err.status < 500 ? err.message : fallback);

export function HistoryPane(props: { appId: string; refreshKey?: number; onRestored?: (buildId: string | null) => void; onViewChanges?: (versionId: string, against: string) => void }) {
  const { appId } = props;
  const [view, setView] = useState<"versions" | "builds">("versions");
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [builds, setBuilds] = useState<BuildRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [report, setReport] = useState<BuildReport | null>(null);
  const reportRequest = useRef(0);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [v, b] = await Promise.all([appsApi.versions(appId), appsApi.builds(appId)]);
      setVersions(v.versions);
      setBuilds(b.builds);
    } catch (err) {
      setError(plainError(err, "Something went wrong on our side."));
    }
  }, [appId]);

  useEffect(() => {
    void load();
  }, [load, props.refreshKey]);

  async function restore(v: Version) {
    if (!window.confirm(`Go back to "${v.message}"?\n\nYour app goes back to how it was at this point. This is saved as a new version, so you can always undo it. Your live site only changes when you publish.`)) return;
    setBusy(v.id);
    setNotice(null);
    try {
      const res = await appsApi.restore(appId, v.id);
      setNotice({ tone: "success", text: "Done — your app is back to that version. Refreshing the preview now." });
      props.onRestored?.(res.buildId);
      await load();
    } catch (err) {
      setNotice({ tone: "danger", text: plainError(err, "We couldn't go back to that version. Nothing was changed — try again in a moment.") });
    } finally {
      setBusy(null);
    }
  }

  async function openBuild(id: string) {
    const req = ++reportRequest.current;
    setReport(null);
    try {
      const r = await appsApi.buildReport(appId, id, true);
      if (req === reportRequest.current) setReport(r);
    } catch (err) {
      if (req === reportRequest.current) setNotice({ tone: "danger", text: plainError(err, "We couldn't open that update just now.") });
    }
  }

  const loaded = versions !== null && builds !== null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <StateStyles />
      <style>{HISTORY_CSS}</style>
      <PaneHeader
        title="History"
        subtitle="Every change to your app is saved automatically. Go back to any earlier version — even going back can be undone."
        actions={<ViewSwitch value={view} onChange={setView} />}
      />
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      {error && loaded && <Notice tone="danger">{error}</Notice>}

      {error && !loaded ? (
        <ProblemState title="We couldn't load your app's history just now" message={`${error} Every saved version is still safe.`} onRetry={() => void load()} />
      ) : view === "versions" ? (
        !versions ? (
          <TimelineSkeleton />
        ) : versions.length === 0 ? (
          <EmptyHero
            title="No versions yet"
            tint={"var(--ed-accent-text)"}
            body="Every change you or SOL make to your app is saved here automatically, so you can see what changed and go back to any earlier version anytime. Ask SOL to build something and your first version will show up here."
            art={<TimelineIllustration />}
          />
        ) : (
          <VersionTimeline versions={versions} busy={busy} onRestore={(v) => void restore(v)} onViewChanges={props.onViewChanges} />
        )
      ) : !builds ? (
        <ListSkeleton rows={5} label="Loading updates" />
      ) : builds.length === 0 ? (
        <EmptyHero title="No updates yet" tint="var(--ed-violet)" body="Each time your preview refreshes or you publish, it's logged here — with what went wrong, if anything did, so SOL can fix it." />
      ) : (
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-start" }}>
          <BuildList builds={builds} selected={report?.buildId ?? null} onOpen={(id) => void openBuild(id)} />
          {report && <BuildDetail report={report} />}
        </div>
      )}
    </div>
  );
}

/** Versions ↔ updates, styled like the editor's other segmented switches. */
function ViewSwitch({ value, onChange }: { value: "versions" | "builds"; onChange: (v: "versions" | "builds") => void }) {
  const options = [
    { id: "versions" as const, label: "Versions", icon: History },
    { id: "builds" as const, label: "Updates", icon: Hammer },
  ];
  return (
    <div role="tablist" aria-label="Show" style={{ display: "inline-flex", border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
      {options.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={value === id}
          onClick={() => onChange(id)}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "0.4rem 0.8rem", fontSize: "0.76rem", fontWeight: 600, border: "none", cursor: "pointer", fontFamily: "inherit", background: value === id ? "color-mix(in srgb, var(--brand) 25%, transparent)" : "transparent", color: value === id ? C.text : C.muted }}
        >
          <Icon size={14} /> {label}
        </button>
      ))}
    </div>
  );
}

function VersionTimeline({ versions, busy, onRestore, onViewChanges }: { versions: Version[]; busy: string | null; onRestore: (v: Version) => void; onViewChanges?: (versionId: string, against: string) => void }) {
  const weekAgo = Date.now() - 7 * 86_400_000;
  const stats = [
    { label: versions.length === 1 ? "Version saved" : "Versions saved", value: versions.length, color: "var(--ed-accent-text)", icon: History },
    { label: "Made by SOL", value: versions.filter((v) => v.source === "ai").length, color: "var(--brand-light)", icon: Bot },
    { label: "This week", value: versions.filter((v) => Date.parse(v.createdAt) > weekAgo).length, color: "var(--ed-violet)", icon: CalendarClock },
  ];

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
        {stats.map((s) => (
          <StatCard key={s.label} {...s} value={s.value.toLocaleString()} />
        ))}
      </div>
      <section style={{ border: `1px solid ${C.border}`, borderRadius: 18, background: C.panel, padding: "0.6rem 1rem 0.8rem" }}>
        <ol style={{ listStyle: "none", margin: 0, padding: 0, position: "relative" }}>
          {/* The timeline's spine, running behind every dot. */}
          <span aria-hidden style={{ position: "absolute", left: 19, top: 22, bottom: 22, width: 2, borderRadius: 2, background: "linear-gradient(180deg, color-mix(in srgb, var(--brand) 60%, transparent), color-mix(in srgb, var(--ed-violet) 30%, transparent) 50%, var(--ed-w-060))" }} />
          {versions.map((v, i) => {
            const previous = versions[i + 1];
            const day = dayLabel(v.createdAt);
            const newDay = i === 0 || dayLabel(versions[i - 1].createdAt) !== day;
            const src = sourceOf(v.source);
            const Icon = src.icon;
            const current = i === 0;
            return (
              <li key={v.id}>
                {newDay && (
                  <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 14, padding: "0.8rem 0 0.4rem" }}>
                    <span aria-hidden style={{ width: 40, display: "grid", placeItems: "center", flexShrink: 0 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 99, background: C.bg, border: `2px solid ${C.borderStrong}` }} />
                    </span>
                    <span style={{ fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: C.faint }}>{day}</span>
                  </div>
                )}
                <div style={{ position: "relative", display: "flex", alignItems: "flex-start", gap: 14, padding: "0.35rem 0" }}>
                  <span aria-hidden style={{ width: 40, height: 40, borderRadius: 99, flexShrink: 0, display: "grid", placeItems: "center", background: `linear-gradient(135deg, ${src.color}, color-mix(in srgb, ${src.color} 67%, transparent))`, color: "#fff", border: `3px solid ${C.bg}`, boxShadow: current ? `0 0 0 3px color-mix(in srgb, ${src.color} 25%, transparent), 0 8px 24px color-mix(in srgb, ${src.color} 25%, transparent)` : "0 6px 18px rgba(0,0,0,0.3)", marginTop: 4 }}>
                    <Icon size={16} />
                  </span>
                  <div
                    className="plx-row"
                    style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: "0.7rem 1rem", flexWrap: "wrap", padding: "0.8rem 1rem", borderRadius: 14, border: `1px solid ${current ? `color-mix(in srgb, ${src.color} 33%, transparent)` : C.border}`, background: current ? `linear-gradient(135deg, color-mix(in srgb, ${src.color} 8%, transparent), transparent 70%)` : "transparent", opacity: busy === v.id ? 0.55 : 1 }}
                  >
                    <div style={{ flex: "1 1 260px", minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontSize: "0.88rem", fontWeight: 600, color: C.text, lineHeight: 1.4, overflowWrap: "anywhere" }}>{v.message}</span>
                        {current && <Pill color={"var(--ed-accent-text)"}>Current version</Pill>}
                        {v.isLive && <Pill color={C.success}>Live on your site</Pill>}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, fontSize: "0.75rem", color: C.muted }}>
                        <span style={{ color: src.color, fontWeight: 650 }}>{src.label}</span>
                        {v.authorName && v.source !== "ai" && <span>· by {v.authorName}</span>}
                        <span>· {timeAgo(v.createdAt)}</span>
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      {previous && onViewChanges && (
                        <Button size="sm" variant="ghost" onClick={() => onViewChanges(previous.id, v.id)}>
                          <Eye size={14} /> See changes
                        </Button>
                      )}
                      {!current && (
                        <Button size="sm" disabled={busy !== null} onClick={() => onRestore(v)}>
                          <RotateCcw size={14} /> {busy === v.id ? "Going back…" : "Go back to this version"}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </section>
    </>
  );
}

/** First load: stat cards and a timeline, gently shimmering. */
function TimelineSkeleton() {
  const widths = [58, 44, 66, 50, 38];
  return (
    <div aria-busy="true" aria-label="Loading your history" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 14, padding: "1rem 1.1rem", borderRadius: 16, border: `1px solid ${C.border}` }}>
            <Shimmer width={40} height={40} radius={12} />
            <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 7 }}>
              <Shimmer width={44} height={16} />
              <Shimmer width="50%" height={8} radius={99} />
            </span>
          </div>
        ))}
      </div>
      <div style={{ position: "relative", border: `1px solid ${C.border}`, borderRadius: 18, padding: "0.8rem 1rem" }}>
        <span aria-hidden style={{ position: "absolute", left: 35, top: 30, bottom: 30, width: 2, background: "var(--ed-w-060)" }} />
        {widths.map((w, i) => (
          <div key={i} style={{ position: "relative", display: "flex", alignItems: "center", gap: 14, padding: "0.45rem 0" }}>
            <Shimmer width={40} height={40} radius={99} />
            <span style={{ flex: 1, display: "flex", alignItems: "center", gap: 14, padding: "0.85rem 1rem", borderRadius: 14, border: `1px solid ${C.border}` }}>
              <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 7 }}>
                <Shimmer width={`${w}%`} height={11} radius={99} />
                <Shimmer width="20%" height={8} radius={99} />
              </span>
              <Shimmer width={150} height={26} radius={9} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** A little timeline of coloured versions, the newest glowing at the top. */
function TimelineIllustration() {
  const steps = [
    { c: "var(--ed-accent-text)", w: "64%" },
    { c: "var(--brand-light)", w: "48%" },
    { c: "var(--ed-violet)", w: "56%" },
    { c: "var(--brand-soft)", w: "40%" },
  ];
  return (
    <div style={{ position: "relative", borderRadius: 16, background: "color-mix(in srgb, var(--ed-bg) 60%, transparent)", border: `1px solid ${C.borderStrong}`, padding: "18px 18px 18px 16px", boxShadow: "0 24px 60px rgba(0,0,0,0.35)", transform: "rotate(-1.5deg)", display: "flex", flexDirection: "column", gap: 12 }}>
      <span style={{ position: "absolute", left: 30, top: 30, bottom: 30, width: 2, background: "linear-gradient(180deg, color-mix(in srgb, var(--brand) 70%, transparent), color-mix(in srgb, var(--ed-lavender) 20%, transparent))" }} />
      {steps.map((s, i) => (
        <div key={i} style={{ position: "relative", display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ width: 28, height: 28, borderRadius: 99, flexShrink: 0, background: `linear-gradient(135deg, ${s.c}, color-mix(in srgb, ${s.c} 60%, transparent))`, border: "3px solid var(--ed-bg)", boxShadow: i === 0 ? `0 0 0 3px color-mix(in srgb, ${s.c} 25%, transparent)` : "none" }} />
          <span style={{ flex: 1, display: "flex", alignItems: "center", gap: 10, padding: "9px 11px", borderRadius: 10, border: `1px solid ${i === 0 ? `color-mix(in srgb, ${s.c} 40%, transparent)` : C.border}`, background: i === 0 ? `color-mix(in srgb, ${s.c} 10%, transparent)` : "var(--ed-w-030)" }}>
            <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 5 }}>
              <span style={{ width: s.w, height: 7, borderRadius: 99, background: "var(--ed-w-320)" }} />
              <span style={{ width: "30%", height: 5, borderRadius: 99, background: "var(--ed-w-120)" }} />
            </span>
            {i > 0 && (
              <span style={{ color: s.c, display: "grid", placeItems: "center" }}>
                <RotateCcw size={13} />
              </span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

const STATUS: Record<string, { label: string; color: string }> = {
  SUCCEEDED: { label: "Worked", color: C.success },
  FAILED: { label: "Had a problem", color: C.danger },
  CANCELLED: { label: "Stopped", color: C.muted },
  BUILDING: { label: "In progress", color: "var(--brand-soft)" },
  QUEUED: { label: "Waiting", color: C.warning },
};

function BuildList({ builds, selected, onOpen }: { builds: BuildRow[]; selected: string | null; onOpen: (id: string) => void }) {
  return (
    <section style={{ flex: "1 1 340px", minWidth: 0, border: `1px solid ${C.border}`, borderRadius: 18, background: C.panel, overflow: "hidden" }}>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {builds.map((b) => {
          const status = STATUS[b.status] ?? { label: b.status.toLowerCase(), color: C.muted };
          const publish = b.mode === "release";
          const Icon = publish ? Rocket : Eye;
          const tint = publish ? "var(--brand-deep)" : "var(--ed-violet)";
          return (
            <li key={b.id} className="plx-history-build" style={{ borderBottom: `1px solid ${C.border}` }}>
              <button
                type="button"
                className="plx-row"
                onClick={() => onOpen(b.id)}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "0.75rem 1rem", border: "none", borderLeft: `3px solid ${selected === b.id ? C.brand : "transparent"}`, background: selected === b.id ? "color-mix(in srgb, var(--brand) 8%, transparent)" : "transparent", color: C.text, textAlign: "left", cursor: "pointer", fontFamily: "inherit" }}
              >
                <span aria-hidden style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0, display: "grid", placeItems: "center", background: `color-mix(in srgb, ${tint} 15%, transparent)`, color: tint }}>
                  <Icon size={16} />
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: "0.84rem", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.summary ?? (publish ? "Published your app" : "Refreshed the preview")}</span>
                  <span style={{ display: "block", fontSize: "0.73rem", color: C.muted, marginTop: 2 }}>
                    {publish ? "Publish" : "Preview"} · {timeAgo(b.createdAt)}
                  </span>
                </span>
                <Pill color={status.color}>{status.label}</Pill>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function BuildDetail({ report }: { report: BuildReport }) {
  const problems = [...report.errors, ...report.typeProblems];
  const failedFns = report.functions?.failed ?? [];
  return (
    <section style={{ flex: "2 1 440px", minWidth: 0, border: `1px solid ${C.border}`, borderRadius: 18, background: C.panel, padding: "1.1rem 1.2rem", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span aria-hidden style={{ width: 40, height: 40, borderRadius: 12, flexShrink: 0, display: "grid", placeItems: "center", background: report.mode === "release" ? "color-mix(in srgb, var(--brand-deep) 20%, transparent)" : "color-mix(in srgb, var(--ed-violet) 20%, transparent)", color: report.mode === "release" ? "var(--brand-soft)" : "var(--ed-lavender)" }}>
          {report.mode === "release" ? <Rocket size={18} /> : <Eye size={18} />}
        </span>
        <div style={{ minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: "0.98rem", fontWeight: 700, color: C.text }}>{report.mode === "release" ? "Publish" : "Preview update"}</h3>
          <p style={{ margin: "0.15rem 0 0", fontSize: "0.78rem", color: C.muted, lineHeight: 1.5 }}>{report.summary}</p>
        </div>
      </div>
      {problems.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {problems.map((e, i) => (
            <div key={i} style={{ fontSize: "0.76rem", padding: "0.55rem 0.7rem", borderRadius: 10, background: "rgba(0,0,0,0.25)", borderLeft: `3px solid ${e.kind === "type" ? C.warning : C.danger}` }}>
              <div style={{ fontFamily: C.mono, color: e.kind === "type" ? C.warning : C.danger }}>
                {e.file ?? e.kind}
                {e.line ? `:${e.line}` : ""}
              </div>
              <div style={{ whiteSpace: "pre-wrap" }}>{e.message}</div>
              {e.snippet && <pre style={{ margin: "4px 0 0", fontFamily: C.mono, color: C.faint, whiteSpace: "pre-wrap" }}>{e.snippet}</pre>}
            </div>
          ))}
        </div>
      )}
      {report.migrations && (report.migrations.applied.length > 0 || report.migrations.failed) && (
        <Notice tone={report.migrations.failed ? "danger" : "success"}>
          {report.migrations.failed
            ? `Database change ${report.migrations.failed.name} failed: ${report.migrations.failed.message}`
            : `Database changes applied: ${report.migrations.applied.join(", ")}`}
        </Notice>
      )}
      {report.functions && (report.functions.deployed.length > 0 || failedFns.length > 0) && (
        <Notice tone={failedFns.length ? "danger" : "success"}>
          {report.functions.deployed.length > 0 && `Functions deployed: ${report.functions.deployed.join(", ")}. `}
          {failedFns.map((f) => `${f.name} failed: ${f.message}`).join(" ")}
        </Notice>
      )}
      {report.log && (
        <details>
          <summary style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.76rem", color: C.muted, cursor: "pointer" }}>
            <FileText size={13} /> Full details (for SOL or support)
          </summary>
          <pre style={{ margin: "8px 0 0", maxHeight: 320, overflow: "auto", padding: "0.7rem", borderRadius: 10, background: "rgba(0,0,0,0.35)", fontFamily: C.mono, fontSize: "0.7rem", color: C.muted, whiteSpace: "pre-wrap" }}>{report.log}</pre>
        </details>
      )}
    </section>
  );
}

const HISTORY_CSS = `
.plx-history-build:last-child { border-bottom: none !important; }
`;
