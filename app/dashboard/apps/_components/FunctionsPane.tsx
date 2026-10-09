"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Play, RefreshCw, Server } from "lucide-react";
import { api, ApiError, type AppEnv } from "./api";
import { Button, C, Empty, Notice, Panel, inputStyle, timeAgo } from "./ui";

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
  { minutes: 15, label: "15m" },
  { minutes: 60, label: "1h" },
  { minutes: 24 * 60, label: "24h" },
];

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const pad = (n: number) => String(n).padStart(2, "0");
const isNum = (s: string) => /^\d+$/.test(s);

/** Turns the common 5-field UTC cron shapes into words; anything unusual is shown as-is. */
export function describeSchedule(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;
  const [min, hour, dom, mon, dow] = parts;
  if (mon !== "*") return `cron: ${cron}`;
  if (min === "*" && hour === "*" && dom === "*" && dow === "*") return "every minute";
  const everyMin = min.match(/^\*\/(\d+)$/);
  if (everyMin && hour === "*" && dom === "*" && dow === "*") return `every ${everyMin[1]} minutes`;
  if (isNum(min) && hour === "*" && dom === "*" && dow === "*") return min === "0" ? "every hour, on the hour" : `every hour at :${pad(+min)}`;
  const everyHour = hour.match(/^\*\/(\d+)$/);
  if (isNum(min) && everyHour && dom === "*" && dow === "*") return `every ${everyHour[1]} hours`;
  if (!isNum(min) || !isNum(hour)) return `cron: ${cron}`;
  const at = `${pad(+hour)}:${pad(+min)} UTC`;
  if (dom === "*" && dow === "*") return `every day at ${at}`;
  if (dom === "*" && (dow === "1-5" || dow === "MON-FRI")) return `every weekday at ${at}`;
  if (dom === "*" && (dow === "0,6" || dow === "6,0" || dow === "SAT,SUN")) return `every weekend day at ${at}`;
  if (dom === "*" && isNum(dow) && +dow <= 7) return `every ${DAYS[+dow % 7]} at ${at}`;
  if (isNum(dom) && dow === "*") return `on day ${+dom} of every month at ${at}`;
  return `cron: ${cron}`;
}

function StatusDot({ status }: { status: FunctionRow["status"] }) {
  const color = status === "READY" ? C.success : status === "FAILED" ? C.danger : C.warning;
  const label = status === "READY" ? "Running" : status === "FAILED" ? "Failed" : "Deploying";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: "0.72rem", color }}>
      <span aria-hidden style={{ width: 7, height: 7, borderRadius: 99, background: color }} />
      {label}
    </span>
  );
}

function EnvBadge({ env }: { env: AppEnv }) {
  const live = env === "live";
  return (
    <span
      style={{
        fontSize: "0.66rem",
        fontWeight: 700,
        padding: "0.1rem 0.4rem",
        borderRadius: 6,
        background: live ? "rgba(52,211,153,0.12)" : "rgba(139,92,246,0.15)",
        color: live ? C.success : "#c4b5fd",
      }}
    >
      {live ? "Live" : "Preview"}
    </span>
  );
}

export function FunctionsPane({ appId, refreshKey }: { appId: string; refreshKey?: number }) {
  const [functions, setFunctions] = useState<FunctionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ name: string; env: AppEnv } | null>(null);

  const load = useCallback(
    async (signal?: { cancelled: boolean }) => {
      try {
        const res = await api<{ functions: FunctionRow[] }>(`/api/v1/apps/${appId}/functions`);
        if (signal?.cancelled) return;
        const sorted = [...res.functions].sort((a, b) => a.name.localeCompare(b.name) || (a.env === b.env ? 0 : a.env === "dev" ? -1 : 1));
        setFunctions(sorted);
        setError(null);
      } catch (err) {
        if (!signal?.cancelled) setError(err instanceof ApiError ? err.message : "Couldn't load server functions.");
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

  if (error && !functions) {
    return (
      <div style={{ padding: "1rem" }}>
        <Notice tone="danger">
          {error}{" "}
          <button type="button" onClick={() => void load()} style={linkButton}>
            Try again
          </button>
        </Notice>
      </div>
    );
  }
  if (!functions) return <p style={{ padding: "1rem", color: C.muted, fontSize: "0.8rem" }}>Loading server functions…</p>;
  if (!functions.length) {
    return (
      <Empty title="No server functions yet">
        Code that runs on the server: send emails, take payments, call AI or other APIs with secret keys. Add a file in <code style={{ fontFamily: C.mono }}>functions/</code> (or ask SOL) and build.
      </Empty>
    );
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.9rem", padding: "1rem", alignItems: "flex-start" }}>
      <div style={{ flex: "1 1 240px", maxWidth: "100%", minWidth: 0 }}>
        <Panel
          title="Server functions"
          actions={
            <Button size="sm" variant="ghost" onClick={() => void load()} aria-label="Refresh functions">
              <RefreshCw size={13} />
            </Button>
          }
        >
          <ul role="listbox" aria-label="Server functions" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
            {functions.map((f) => {
              const active = !!selected && selected.name === f.name && selected.env === f.env;
              return (
                <li key={`${f.env}:${f.name}`} role="option" aria-selected={active}>
                  <button
                    type="button"
                    onClick={() => setSelected({ name: f.name, env: f.env })}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "0.55rem 0.65rem",
                      borderRadius: 9,
                      border: `1px solid ${active ? "rgba(139,92,246,0.45)" : "transparent"}`,
                      background: active ? "rgba(139,92,246,0.12)" : "transparent",
                      color: C.text,
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                    }}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                      <Server size={13} color={C.muted} aria-hidden />
                      <span style={{ fontFamily: C.mono, fontSize: "0.78rem", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{f.name}</span>
                      <EnvBadge env={f.env} />
                    </span>
                    <span style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem 0.7rem", fontSize: "0.7rem", color: C.muted }}>
                      <StatusDot status={f.status} />
                      {f.schedule && <span>Runs {describeSchedule(f.schedule)}</span>}
                      <span>Deployed {timeAgo(f.deployedAt)}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Panel>
      </div>
      <div style={{ flex: "2 1 380px", maxWidth: "100%", minWidth: 0 }}>{current && <FunctionDetail key={`${current.env}:${current.name}`} appId={appId} fn={current} />}</div>
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
      if (seq === requestSeq.current) setLogError(err instanceof ApiError ? err.message : "Couldn't load logs.");
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
      setRunError(err instanceof ApiError ? err.message : "Couldn't run the function.");
    } finally {
      setRunning(false);
    }
  };

  const ok = runResult && runResult.status >= 200 && runResult.status < 400;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
      <Panel
        title={fn.name}
        description={
          <>
            {fn.env === "live" ? "The live version, used by your visitors." : "The preview version, used while you build."}{" "}
            {fn.schedule ? `Runs automatically ${describeSchedule(fn.schedule)}.` : "Runs when your app calls it."}
          </>
        }
        actions={
          <Button size="sm" variant="primary" onClick={() => void run()} disabled={running || fn.status !== "READY"} aria-busy={running}>
            <Play size={13} aria-hidden /> {running ? "Running…" : "Run now"}
          </Button>
        }
      >
        {fn.status === "FAILED" && (
          <div style={{ marginBottom: "0.7rem" }}>
            <Notice tone="danger">This function didn&apos;t deploy{fn.statusMessage ? `: ${fn.statusMessage}` : "."} Fix the code and build again.</Notice>
          </div>
        )}
        {fn.status === "DEPLOYING" && (
          <div style={{ marginBottom: "0.7rem" }}>
            <Notice tone="warning">Still deploying — it&apos;ll be ready in a moment.</Notice>
          </div>
        )}
        {runError && <Notice tone="danger">{runError}</Notice>}
        {runResult && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }} aria-live="polite">
            <span style={{ fontSize: "0.76rem", color: ok ? C.success : C.danger, fontWeight: 600 }}>
              {ok ? "Finished" : "Finished with an error"} — status {runResult.status}
            </span>
            <pre style={preStyle}>{runResult.body || "(no response body)"}</pre>
          </div>
        )}
        {!runError && !runResult && <p style={{ margin: 0, fontSize: "0.74rem", color: C.faint }}>“Run now” calls it right away, the same way its schedule would.</p>}
      </Panel>

      <Panel title="Logs" description="What the function printed (console.log) and any errors it hit.">
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center", marginBottom: "0.7rem" }}>
          <div role="group" aria-label="Time window" style={{ display: "inline-flex", border: `1px solid ${C.border}`, borderRadius: 9, overflow: "hidden" }}>
            {WINDOWS.map((w) => (
              <button
                key={w.minutes}
                type="button"
                aria-pressed={minutes === w.minutes}
                onClick={() => setMinutes(w.minutes)}
                style={{ padding: "0.32rem 0.6rem", fontSize: "0.74rem", fontWeight: 600, border: "none", cursor: "pointer", background: minutes === w.minutes ? "rgba(139,92,246,0.25)" : "transparent", color: minutes === w.minutes ? C.text : C.muted }}
              >
                {w.label}
              </button>
            ))}
          </div>
          <input
            type="search"
            value={filterInput}
            onChange={(e) => setFilterInput(e.target.value)}
            placeholder="Filter (e.g. error)"
            aria-label="Filter logs"
            style={{ ...inputStyle, flex: "1 1 140px", width: "auto", padding: "0.35rem 0.6rem" }}
          />
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.74rem", color: C.muted, cursor: "pointer" }}>
            <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
            Auto-refresh
          </label>
          <Button size="sm" variant="ghost" onClick={() => void fetchLogs()} disabled={loadingLogs} aria-label="Refresh logs">
            <RefreshCw size={13} aria-hidden />
          </Button>
        </div>
        {logError && (
          <div style={{ marginBottom: "0.6rem" }}>
            <Notice tone="danger">{logError}</Notice>
          </div>
        )}
        <div
          ref={logBox}
          role="log"
          aria-live="off"
          aria-busy={loadingLogs}
          style={{ maxHeight: 380, minHeight: 120, overflow: "auto", background: "rgba(0,0,0,0.35)", border: `1px solid ${C.border}`, borderRadius: 10, padding: "0.5rem 0.65rem", fontFamily: C.mono, fontSize: "0.72rem", lineHeight: 1.55 }}
        >
          {logs === null ? (
            <span style={{ color: C.muted }}>Loading logs…</span>
          ) : logs.length === 0 ? (
            <span style={{ color: C.muted }}>{filter ? `No log lines matching “${filter}” in this window.` : "Nothing logged in this window. Try a longer window, or run the function."}</span>
          ) : (
            logs.map((l, i) => (
              <div key={`${l.at}-${i}`} style={{ display: "flex", gap: "0.7rem", color: /error|exception|failed/i.test(l.message) ? C.danger : C.text }}>
                <time dateTime={l.at} style={{ color: C.faint, flexShrink: 0 }} title={new Date(l.at).toLocaleString()}>
                  {new Date(l.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </time>
                <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", minWidth: 0 }}>{l.message}</span>
              </div>
            ))
          )}
        </div>
      </Panel>
    </div>
  );
}

const preStyle = {
  margin: 0,
  maxHeight: 240,
  overflow: "auto",
  background: "rgba(0,0,0,0.35)",
  border: `1px solid ${C.border}`,
  borderRadius: 10,
  padding: "0.55rem 0.7rem",
  fontFamily: C.mono,
  fontSize: "0.72rem",
  color: C.text,
  whiteSpace: "pre-wrap" as const,
  wordBreak: "break-word" as const,
};

const linkButton = { background: "none", border: "none", padding: 0, color: "inherit", textDecoration: "underline", cursor: "pointer", font: "inherit" };
