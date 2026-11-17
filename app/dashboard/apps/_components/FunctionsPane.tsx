"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType } from "react";
import { AlertTriangle, Bot, CheckCircle2, CalendarClock, ChevronDown, Clock, Code2, CreditCard, Mail, Play, RefreshCw, ScrollText, Search, Server, Webhook } from "lucide-react";
import { api, ApiError, type AppEnv } from "./api";
import { Button, C, EmptyHero, IconButton, Notice, PaneHeader, Pill, ProblemState, Shimmer, StatCard, StateStyles, hueGradient, inputStyle, timeAgo, SolIdeas } from "./ui";

// "Server code": the small pieces of the app that run on Plexo's servers rather than in the
// visitor's browser — sending emails, taking payments, jobs that run on a schedule.

type FunctionRow = {
  name: string;
  env: AppEnv;
  status: "DEPLOYING" | "READY" | "FAILED";
  statusMessage: string | null;
  schedule: string | null;
  deployedAt: string | null;
  buildId: string | null;
};

type LogLine = { at: string; message: string; requestId?: string };
type RunResult = { status: number; body: string };

const WINDOWS = [
  { minutes: 15, label: "Last 15 min" },
  { minutes: 60, label: "Last hour" },
  { minutes: 24 * 60, label: "Last day" },
];

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const pad = (n: number) => String(n).padStart(2, "0");
const isNum = (s: string) => /^\d+$/.test(s);
const CUSTOM = "on a custom schedule";

/** Turns the common 5-field UTC cron shapes into words; anything unusual reads as "on a custom
 *  schedule" (the raw value is shown as a tooltip where it's used). */
export function describeSchedule(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return CUSTOM;
  const [min, hour, dom, mon, dow] = parts;
  if (mon !== "*") return CUSTOM;
  if (min === "*" && hour === "*" && dom === "*" && dow === "*") return "every minute";
  const everyMin = min.match(/^\*\/(\d+)$/);
  if (everyMin && hour === "*" && dom === "*" && dow === "*") return `every ${everyMin[1]} minutes`;
  if (isNum(min) && hour === "*" && dom === "*" && dow === "*") return min === "0" ? "every hour, on the hour" : `every hour at :${pad(+min)}`;
  const everyHour = hour.match(/^\*\/(\d+)$/);
  if (isNum(min) && everyHour && dom === "*" && dow === "*") return `every ${everyHour[1]} hours`;
  if (!isNum(min) || !isNum(hour)) return CUSTOM;
  const at = `${pad(+hour)}:${pad(+min)} UTC`;
  if (dom === "*" && dow === "*") return `every day at ${at}`;
  if (dom === "*" && (dow === "1-5" || dow === "MON-FRI")) return `every weekday at ${at}`;
  if (dom === "*" && (dow === "0,6" || dow === "6,0" || dow === "SAT,SUN")) return `every weekend day at ${at}`;
  if (dom === "*" && isNum(dow) && +dow <= 7) return `every ${DAYS[+dow % 7]} at ${at}`;
  if (isNum(dom) && dow === "*") return `on day ${+dom} of every month at ${at}`;
  return CUSTOM;
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "send-welcome-email" / "sendWelcomeEmail" → "Send welcome email". */
function friendlyName(name: string): string {
  const words = name
    .replace(/\.[a-z]+$/i, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[-_\s/]+/)
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return words ? capitalise(words) : name;
}

/** A picture for each function, guessed from its name so the list is easy to scan. */
function iconFor(fn: FunctionRow): ComponentType<{ size?: number }> {
  const n = fn.name.toLowerCase();
  if (/mail|email|newsletter|notify|notification/.test(n)) return Mail;
  if (/pay|stripe|checkout|charge|invoice|billing|order|subscri/.test(n)) return CreditCard;
  if (/ai|chat|gpt|claude|summar|generate/.test(n)) return Bot;
  if (/hook|callback|webhook/.test(n)) return Webhook;
  if (fn.schedule || /cron|daily|weekly|nightly|schedule|reminder/.test(n)) return CalendarClock;
  return Code2;
}

const STATUS: Record<FunctionRow["status"], { label: string; color: string }> = {
  READY: { label: "Running fine", color: C.success },
  FAILED: { label: "Had a problem", color: C.danger },
  DEPLOYING: { label: "Getting ready", color: C.warning },
};

function EnvTag({ env }: { env: AppEnv }) {
  const live = env === "live";
  return (
    <span style={{ fontSize: "0.68rem", fontWeight: 700, padding: "3px 8px", borderRadius: 99, whiteSpace: "nowrap", background: live ? "color-mix(in srgb, var(--brand) 22%, transparent)" : "color-mix(in srgb, var(--ed-lavender) 10%, transparent)", color: live ? "var(--ed-lavender)" : C.muted, border: `1px solid ${live ? "color-mix(in srgb, var(--brand) 40%, transparent)" : C.border}` }}>
      {live ? "Live" : "Preview"}
    </span>
  );
}

/** What sets it off, in plain words. */
function Trigger({ schedule }: { schedule: string | null }) {
  if (!schedule) return <>Runs when your app asks for it</>;
  return <span title={`Schedule: ${schedule} (UTC)`}>Runs {describeSchedule(schedule)}</span>;
}

export function FunctionsPane({ appId, refreshKey, onAskAi }: { appId: string; refreshKey?: number; onAskAi?: (text: string) => void }) {
  const [functions, setFunctions] = useState<FunctionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ name: string; env: AppEnv } | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (signal?: { cancelled: boolean }) => {
      try {
        const res = await api<{ functions: FunctionRow[] }>(`/api/v1/apps/${appId}/functions`);
        if (signal?.cancelled) return;
        const sorted = [...res.functions].sort((a, b) => a.name.localeCompare(b.name) || (a.env === b.env ? 0 : a.env === "dev" ? -1 : 1));
        setFunctions(sorted);
        setError(null);
      } catch (err) {
        if (!signal?.cancelled) setError(err instanceof ApiError ? err.message : "Something went wrong on our side.");
      }
    },
    [appId],
  );

  useEffect(() => {
    const signal = { cancelled: false };
    void load(signal);
    return () => {
      signal.cancelled = true;
    };
  }, [load, refreshKey]);

  // Keep the selection valid as functions come and go between builds.
  useEffect(() => {
    if (!functions) return;
    if (selected && functions.some((f) => f.name === selected.name && f.env === selected.env)) return;
    setSelected(functions[0] ? { name: functions[0].name, env: functions[0].env } : null);
  }, [functions, selected]);

  const current = useMemo(() => functions?.find((f) => selected && f.name === selected.name && f.env === selected.env) ?? null, [functions, selected]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  // Summary numbers, counted per piece of code (its Preview and Live copies count once).
  const stats = useMemo(() => {
    if (!functions?.length) return null;
    const names = new Set(functions.map((f) => f.name));
    const scheduled = new Set(functions.filter((f) => f.schedule).map((f) => f.name));
    const problems = functions.filter((f) => f.status === "FAILED").length;
    return { total: names.size, scheduled: scheduled.size, problems };
  }, [functions]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <StateStyles />
      <PaneHeader
        title="Server code"
        subtitle="The parts of your app that run on our servers, not in your visitor's browser: sending emails, taking payments, jobs that run on a schedule."
        actions={
          functions && functions.length > 0 ? (
            <Button size="sm" onClick={() => void refresh()} disabled={refreshing} aria-busy={refreshing}>
              <RefreshCw size={14} aria-hidden /> {refreshing ? "Checking…" : "Refresh"}
            </Button>
          ) : undefined
        }
      />

      {error && !functions ? (
        <ProblemState title="We couldn't load your server code just now" message={`${error} Your app keeps running as normal in the meantime.`} onRetry={() => void load()} />
      ) : !functions ? (
        <FunctionsSkeleton />
      ) : functions.length === 0 ? (
        <EmptyHero
          tint={"var(--ed-accent-text)"}
          title="No server code yet"
          body={
            <>
              Some things have to happen on a server, not in the visitor&rsquo;s browser: sending emails, taking payments, running a task every morning. SOL adds these here when your app needs them. Just describe what you want, like &ldquo;email me when someone fills in the contact form&rdquo;, and you&rsquo;ll see it appear here with a record of every time it runs.
            </>
          }
          art={<ServerIllustration />}
        >
          {onAskAi && (
            <SolIdeas
              ideas={["Email me when someone fills in the contact form", "Send new sign-ups a welcome email", "Take a card payment when someone places an order", "Every morning, email me yesterday's new sign-ups"]}
              onPick={onAskAi}
            />
          )}
        </EmptyHero>
      ) : (
        <>
          {error && <Notice tone="warning">We couldn&rsquo;t refresh just now: {error} What you see below may be a moment out of date.</Notice>}
          {stats && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 }}>
              <StatCard label={stats.total === 1 ? "Piece of server code" : "Pieces of server code"} value={stats.total} color={"var(--ed-accent-text)"} icon={Server} />
              <StatCard label="Run on a schedule" value={stats.scheduled} color={"var(--brand-light)"} icon={Clock} />
              <StatCard label={stats.problems ? "Need attention" : "All running fine"} value={stats.problems || "✓"} color={stats.problems ? C.danger : C.success} icon={stats.problems ? AlertTriangle : CheckCircle2} />
            </div>
          )}

          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 12 }}>
            {functions.map((f) => {
              const isSelected = !!selected && selected.name === f.name && selected.env === f.env;
              const open = isSelected && expanded;
              const Icon = iconFor(f);
              const status = STATUS[f.status];
              const toggle = () => {
                if (isSelected) return setExpanded(!expanded);
                setSelected({ name: f.name, env: f.env });
                setExpanded(true);
              };
              return (
                <li
                  key={`${f.env}:${f.name}`}
                  style={{ borderRadius: 18, border: `1px solid ${open ? "color-mix(in srgb, var(--brand) 40%, transparent)" : C.border}`, background: open ? "linear-gradient(180deg, color-mix(in srgb, var(--brand) 7%, transparent), var(--ed-w-015) 160px)" : C.panel, overflow: "hidden" }}
                >
                  <div className="plx-row" style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", padding: "1rem 1.15rem", cursor: "pointer" }} onClick={toggle}>
                    <span aria-hidden style={{ width: 46, height: 46, borderRadius: 14, flexShrink: 0, display: "grid", placeItems: "center", background: hueGradient(f.name), color: "var(--ed-on-brand)", boxShadow: "0 8px 22px rgba(0,0,0,0.3)", opacity: f.status === "FAILED" ? 0.6 : 1 }}>
                      <Icon size={21} />
                    </span>
                    <span style={{ flex: "1 1 260px", minWidth: 0 }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                        <span style={{ fontSize: "0.95rem", fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{friendlyName(f.name)}</span>
                        <EnvTag env={f.env} />
                      </span>
                      <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.3rem 0.9rem", marginTop: 5, fontSize: "0.76rem", color: C.muted }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                          {f.schedule ? <Clock size={13} aria-hidden /> : <Play size={12} aria-hidden />}
                          <Trigger schedule={f.schedule} />
                        </span>
                        <span>Updated {timeAgo(f.deployedAt)}</span>
                        <span style={{ color: C.faint, fontFamily: C.mono, fontSize: "0.7rem" }}>{f.name}</span>
                      </span>
                    </span>
                    <span style={{ display: "flex", alignItems: "center", gap: 8 }} onClick={(e) => e.stopPropagation()}>
                      <Pill color={status.color}>{status.label}</Pill>
                      <IconButton label={open ? `Hide activity for ${friendlyName(f.name)}` : `Run and see activity for ${friendlyName(f.name)}`} onClick={toggle}>
                        {open ? <ChevronDown size={15} style={{ transform: "rotate(180deg)" }} /> : <ScrollText size={15} />}
                      </IconButton>
                    </span>
                  </div>
                  {open && current && current.name === f.name && current.env === f.env && (
                    <div style={{ borderTop: `1px solid ${C.border}`, padding: "1.1rem 1.15rem 1.2rem" }}>
                      <FunctionDetail key={`${current.env}:${current.name}`} appId={appId} fn={current} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

/** First load: summary cards and function rows, gently pulsing. */
function FunctionsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading your server code" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 14, padding: "1rem 1.1rem", borderRadius: 16, border: `1px solid ${C.border}` }}>
            <Shimmer width={40} height={40} radius={12} />
            <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 7 }}>
              <Shimmer width={34} height={16} />
              <Shimmer width="60%" height={8} radius={99} />
            </span>
          </div>
        ))}
      </div>
      {[58, 44, 66].map((w, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 16, padding: "1rem 1.15rem", borderRadius: 18, border: `1px solid ${C.border}` }}>
          <Shimmer width={46} height={46} radius={14} />
          <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
            <Shimmer width={`${w * 0.6}%`} height={12} radius={99} />
            <Shimmer width={`${w}%`} height={8} radius={99} />
          </span>
          <Shimmer width={92} height={22} radius={99} />
          <Shimmer width={32} height={32} radius={9} />
        </div>
      ))}
    </div>
  );
}

/** A friendly picture: a few everyday jobs wired up to a server. */
function ServerIllustration() {
  const tasks = [
    { icon: Mail, color: "var(--ed-accent-text)", label: "Email sent", w: "62%" },
    { icon: CreditCard, color: "var(--brand-light)", label: "Payment taken", w: "48%" },
    { icon: Clock, color: "var(--ed-violet)", label: "Every morning", w: "56%" },
  ];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 0, transform: "rotate(-1.5deg)" }}>
      <div style={{ flex: "1 1 auto", display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
        {tasks.map(({ icon: Icon, color, label, w }, i) => (
          <div key={label} style={{ display: "flex", alignItems: "center", marginLeft: i === 1 ? 18 : 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0.6rem 0.75rem", borderRadius: 13, background: "color-mix(in srgb, var(--ed-bg) 70%, transparent)", border: `1px solid ${C.borderStrong}`, boxShadow: "0 14px 34px rgba(0,0,0,0.35)", minWidth: 150 }}>
              <span style={{ width: 30, height: 30, borderRadius: 9, flexShrink: 0, display: "grid", placeItems: "center", background: `color-mix(in srgb, ${color} 20%, transparent)`, color }}>
                <Icon size={15} />
              </span>
              <span style={{ display: "flex", flexDirection: "column", gap: 5, flex: 1 }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: C.text }}>{label}</span>
                <span style={{ width: w, height: 5, borderRadius: 99, background: "var(--ed-w-160)" }} />
              </span>
            </div>
            <span style={{ flex: 1, minWidth: 18, height: 2, background: `linear-gradient(90deg, ${color}, color-mix(in srgb, var(--brand) 25%, transparent))` }} />
          </div>
        ))}
      </div>
      <div style={{ width: 92, flexShrink: 0, borderRadius: 16, padding: 10, display: "flex", flexDirection: "column", gap: 8, background: `linear-gradient(160deg, var(--brand-deep), var(--brand-deeper))`, border: "1px solid color-mix(in srgb, var(--ed-lavender) 35%, transparent)", boxShadow: "0 24px 60px rgba(76,29,149,0.45)" }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 8px", borderRadius: 8, background: "color-mix(in srgb, var(--ed-bg) 35%, transparent)" }}>
            <span style={{ width: 6, height: 6, borderRadius: 99, background: C.success, boxShadow: `0 0 8px ${C.success}` }} />
            <span style={{ flex: 1, height: 4, borderRadius: 99, background: "color-mix(in srgb, var(--ed-lavender) 45%, transparent)" }} />
          </div>
        ))}
        <Server size={18} color="var(--ed-text)" style={{ alignSelf: "center", marginTop: 2 }} />
      </div>
    </div>
  );
}

function FunctionDetail({ appId, fn }: { appId: string; fn: FunctionRow }) {
  const [minutes, setMinutes] = useState(60);
  const [filterInput, setFilterInput] = useState("");
  const [filter, setFilter] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [logs, setLogs] = useState<LogLine[] | null>(null);
  const [logError, setLogError] = useState<string | null>(null);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const requestSeq = useRef(0);
  const logBox = useRef<HTMLDivElement>(null);

  // Debounce the filter so typing doesn't fire a log query per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setFilter(filterInput.trim()), 400);
    return () => clearTimeout(t);
  }, [filterInput]);

  const fetchLogs = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoadingLogs(true);
    try {
      const q = new URLSearchParams({ env: fn.env, minutes: String(minutes) });
      if (filter) q.set("filter", filter);
      const res = await api<{ logs: LogLine[] }>(`/api/v1/apps/${appId}/functions/${encodeURIComponent(fn.name)}?${q}`);
      if (seq !== requestSeq.current) return;
      setLogs(res.logs);
      setLogError(null);
    } catch (err) {
      if (seq === requestSeq.current) setLogError(err instanceof ApiError ? err.message : "We couldn't load its activity just now.");
    } finally {
      if (seq === requestSeq.current) setLoadingLogs(false);
    }
  }, [appId, fn.env, fn.name, minutes, filter]);

  useEffect(() => {
    void fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(() => void fetchLogs(), 5000);
    return () => clearInterval(t);
  }, [autoRefresh, fetchLogs]);

  useEffect(() => () => void (requestSeq.current += 1), []);

  // Follow the newest lines, unless the owner scrolled up to read.
  useEffect(() => {
    const box = logBox.current;
    if (!box) return;
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    if (nearBottom) box.scrollTop = box.scrollHeight;
  }, [logs]);

  const run = async () => {
    setRunning(true);
    setRunError(null);
    setRunResult(null);
    try {
      const res = await api<RunResult>(`/api/v1/apps/${appId}/functions/${encodeURIComponent(fn.name)}?env=${fn.env}`, { method: "POST" });
      setRunResult(res);
      void fetchLogs();
    } catch (err) {
      setRunError(err instanceof ApiError ? err.message : "We couldn't run it just now. Try again in a moment.");
    } finally {
      setRunning(false);
    }
  };

  const ok = runResult && runResult.status >= 200 && runResult.status < 400;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {fn.status === "FAILED" && (
        <Notice tone="danger">
          This piece of code couldn&rsquo;t start{fn.statusMessage ? `: ${fn.statusMessage}` : "."} Ask SOL to fix it, and it&rsquo;ll be back up after the next build.
        </Notice>
      )}
      {fn.status === "DEPLOYING" && <Notice tone="warning">Still getting ready. It&rsquo;ll be able to run in a moment.</Notice>}

      {/* Try it: run it right now and see what it sent back. */}
      <section style={{ display: "flex", flexDirection: "column", gap: 12, padding: "1rem 1.1rem", borderRadius: 14, border: `1px solid ${C.border}`, background: "var(--ed-w-020)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <span style={{ flex: "1 1 280px", minWidth: 0 }}>
            <span style={{ display: "block", fontSize: "0.88rem", fontWeight: 700, color: C.text }}>Try it now</span>
            <span style={{ display: "block", fontSize: "0.76rem", color: C.muted, marginTop: 3, lineHeight: 1.5 }}>
              {fn.env === "live" ? "This is the live copy your visitors use." : "This is the preview copy, used while you build."}{" "}
              {fn.schedule ? `It also runs by itself ${describeSchedule(fn.schedule)}.` : "Your app runs it whenever it's needed."}
            </span>
          </span>
          <Button variant="primary" onClick={() => void run()} disabled={running || fn.status !== "READY"} aria-busy={running}>
            <Play size={14} aria-hidden /> {running ? "Running…" : "Run now"}
          </Button>
        </div>
        {runError && <Notice tone="danger">{runError}</Notice>}
        {runResult && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }} aria-live="polite">
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Pill color={ok ? C.success : C.danger}>{ok ? "Finished fine" : "Finished with a problem"}</Pill>
              <span style={{ fontSize: "0.72rem", color: C.faint }}>code {runResult.status}</span>
            </span>
            <div style={frameStyle}>
              <div style={frameBar}>What it sent back</div>
              <pre style={preStyle}>{runResult.body || "(nothing — it finished without a reply)"}</pre>
            </div>
          </div>
        )}
      </section>

      {/* Activity: everything it wrote down while running, newest at the bottom. */}
      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ flex: "1 1 220px", minWidth: 0 }}>
            <span style={{ display: "block", fontSize: "0.88rem", fontWeight: 700, color: C.text }}>Activity</span>
            <span style={{ display: "block", fontSize: "0.76rem", color: C.muted, marginTop: 3 }}>What it noted down while running, and any errors it hit.</span>
          </span>
          <div role="group" aria-label="Time window" style={{ display: "inline-flex", border: `1px solid ${C.border}`, borderRadius: 9, overflow: "hidden" }}>
            {WINDOWS.map((w) => (
              <button
                key={w.minutes}
                type="button"
                aria-pressed={minutes === w.minutes}
                onClick={() => setMinutes(w.minutes)}
                style={{ padding: "0.36rem 0.7rem", fontSize: "0.74rem", fontWeight: 600, border: "none", cursor: "pointer", background: minutes === w.minutes ? "color-mix(in srgb, var(--brand) 25%, transparent)" : "transparent", color: minutes === w.minutes ? C.text : C.muted }}
              >
                {w.label}
              </button>
            ))}
          </div>
          <label style={{ position: "relative", flex: "0 1 220px", minWidth: 150, display: "flex" }}>
            <Search size={13} color={C.muted} aria-hidden style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)" }} />
            <input
              type="search"
              value={filterInput}
              onChange={(e) => setFilterInput(e.target.value)}
              placeholder="Find (e.g. error)"
              aria-label="Find in activity"
              style={{ ...inputStyle, padding: "0.36rem 0.6rem 0.36rem 1.8rem" }}
            />
          </label>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.74rem", color: C.muted, cursor: "pointer" }}>
            <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} style={{ accentColor: C.brand }} />
            Keep updating
          </label>
          <IconButton label="Refresh activity" disabled={loadingLogs} onClick={() => void fetchLogs()}>
            <RefreshCw size={14} />
          </IconButton>
        </div>
        {logError && <Notice tone="danger">{logError}</Notice>}
        <div style={frameStyle}>
          <div style={{ ...frameBar, display: "flex", alignItems: "center", gap: 6 }}>
            {["var(--ed-accent-text)", "var(--brand-soft)", "var(--ed-lavender)"].map((c) => (
              <span key={c} aria-hidden style={{ width: 8, height: 8, borderRadius: 99, background: c, opacity: 0.8 }} />
            ))}
            <span style={{ marginLeft: 6 }}>{friendlyName(fn.name)} · {fn.env === "live" ? "Live" : "Preview"}</span>
            {autoRefresh && (
              <span style={{ marginLeft: "auto" }}>
                <Pill color={C.success}>Updating</Pill>
              </span>
            )}
          </div>
          <div
            ref={logBox}
            role="log"
            aria-live="off"
            aria-busy={loadingLogs}
            style={{ maxHeight: 380, minHeight: 140, overflow: "auto", padding: "0.7rem 0.85rem", fontFamily: C.mono, fontSize: "0.72rem", lineHeight: 1.6 }}
          >
            {logs === null ? (
              <span style={{ display: "flex", flexDirection: "column", gap: 9 }} aria-label="Loading activity">
                {[70, 52, 84, 40].map((w, i) => (
                  <Shimmer key={i} width={`${w}%`} height={9} radius={99} />
                ))}
              </span>
            ) : logs.length === 0 ? (
              <span style={{ display: "block", padding: "1.6rem 0.5rem", textAlign: "center", color: C.muted, fontFamily: "inherit" }}>
                {filter ? `Nothing matching “${filter}” in this time.` : "Nothing happened in this time. Pick a longer time, or press Run now to try it."}
              </span>
            ) : (
              logs.map((l, i) => {
                const bad = /error|exception|failed/i.test(l.message);
                return (
                  <div key={`${l.at}-${i}`} style={{ display: "flex", gap: "0.8rem", padding: "1px 6px", margin: "0 -6px", borderRadius: 6, color: bad ? C.danger : C.text, background: bad ? "color-mix(in srgb, var(--ed-danger) 7%, transparent)" : "transparent" }}>
                    <time dateTime={l.at} style={{ color: C.faint, flexShrink: 0 }} title={new Date(l.at).toLocaleString()}>
                      {new Date(l.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </time>
                    <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", minWidth: 0 }}>{l.message}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

// A dark, framed window for anything shown in monospace (replies and activity).
const frameStyle = { borderRadius: 12, border: `1px solid ${C.borderStrong}`, background: "var(--ed-scrim)", overflow: "hidden" as const };
const frameBar = { padding: "0.45rem 0.8rem", borderBottom: `1px solid ${C.border}`, fontSize: "0.7rem", fontWeight: 600, color: C.muted, background: "color-mix(in srgb, var(--brand) 6%, transparent)" };

const preStyle = {
  margin: 0,
  maxHeight: 240,
  overflow: "auto",
  padding: "0.65rem 0.85rem",
  fontFamily: C.mono,
  fontSize: "0.72rem",
  color: C.text,
  whiteSpace: "pre-wrap" as const,
  wordBreak: "break-word" as const,
};
