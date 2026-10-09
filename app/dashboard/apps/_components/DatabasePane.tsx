"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import {
  ChevronDown,
  CloudOff,
  Database,
  Heart,
  Mail,
  ShoppingBag,
  Users,
  ChevronLeft,
  ChevronRight,
  KeyRound,
  Link2,
  LoaderCircle,
  Lock,
  MessageSquare,
  Play,
  Plus,
  RefreshCw,
  Search,
  Table2,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { api, ApiError, type AppEnv } from "./api";
import { Button, C, Empty, EnvSwitch, Notice, PaneHeader, Panel, inputStyle, timeAgo } from "./ui";
import { ensureMonaco, EDITOR_THEME } from "./monaco";

// Mirrors lib/appData/overview.ts (kept local so this client bundle doesn't pull server code).
type SecurityFinding = { level: "danger" | "warning" | "info"; table: string; message: string; fix: string };
type Column = { name: string; type: string; nullable: boolean; hasDefault: boolean; primaryKey: boolean; references: string | null };
type Policy = { name: string; command: string; roles: string[]; using: string | null; check: string | null };
type TableOverview = { name: string; kind: "table" | "view"; rowEstimate: number; rls: boolean; policies: Policy[]; columns: Column[] };
type Overview = { env: AppEnv; tables: TableOverview[]; findings: SecurityFinding[]; migrations: Array<{ name: string; appliedAt: string }> };
type Row = Record<string, unknown>;
type RowsResponse = { rows: Row[]; total: number | null; primaryKey: string[] };
type SqlResult = { rows: Row[]; fields: Array<{ name: string; dataTypeID: number }>; rowCount: number | null; truncated: boolean; command?: string; durationMs: number };

const PAGE_SIZE = 50;
const WAKING_MESSAGE = "Your database is waking up — this takes a few seconds the first time after a quiet period.";

/** Runs a request; on 503 (database resuming) shows the waking notice and retries once after 3s. */
async function withWake<T>(fn: () => Promise<T>, setWaking: (v: boolean) => void): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 503) throw err;
    setWaking(true);
    try {
      await new Promise((r) => setTimeout(r, 3000));
      return await fn();
    } finally {
      setWaking(false);
    }
  }
}

function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 503) return WAKING_MESSAGE + " Try again in a moment.";
    return err.hint ? `${err.message} ${err.hint}` : err.message;
  }
  return "Something went wrong on our side.";
}

type EditorKind = "json" | "boolean" | "text";
function editorKind(type: string): EditorKind {
  if (/^jsonb?$/.test(type) || type.endsWith("[]")) return "json";
  if (type === "boolean") return "boolean";
  return "text";
}
const isTextType = (type: string) => /char|text|citext/.test(type) && !type.endsWith("[]");

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function toDraft(v: unknown, kind: EditorKind): string {
  if (v === null || v === undefined) return "";
  if (kind === "json") return JSON.stringify(v, null, 2);
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

/** Turns what the owner typed into a value for the API. Throws a plain-language message. */
function parseDraft(draft: string, column: Column): unknown {
  const kind = editorKind(column.type);
  if (kind === "json") {
    if (!draft.trim()) return null;
    try {
      return JSON.parse(draft);
    } catch {
      throw new Error(`"${column.name}" needs valid JSON — for example {"key": "value"} or ["a", "b"].`);
    }
  }
  if (draft === "" && !isTextType(column.type)) return null;
  return draft;
}

const rowKey = (row: Row, pk: string[]) => JSON.stringify(pk.map((c) => row[c]));
const keyObject = (row: Row, pk: string[]) => Object.fromEntries(pk.map((c) => [c, row[c]]));

const DATA_IDEAS: { icon: typeof Database; color: string; title: string; prompt: string }[] = [
  { icon: Mail, color: "#7c3aed", title: "Contact form messages", prompt: "Save messages people send through a contact form, and show them to me in a list" },
  { icon: Heart, color: "#c084fc", title: "Favourites", prompt: "Let signed-in people save their favourite items and see them on their own page" },
  { icon: ShoppingBag, color: "#a78bfa", title: "Products", prompt: "Keep a list of products with a name, price and photo that I can edit" },
  { icon: Users, color: "#6366f1", title: "Newsletter sign-ups", prompt: "Collect email addresses for a newsletter with a simple sign-up box" },
];

/** Nothing saved yet: what will appear here, and one tap to set something up with SOL. */
function DataEmpty({ onAskAi }: { onAskAi?: (text: string) => void }) {
  return (
    <section className="plx-data-empty" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 0.9fr)", gap: "2rem", alignItems: "center", padding: "2.2rem", borderRadius: 20, border: `1px solid ${C.border}`, background: "radial-gradient(70% 90% at 100% 0%, rgba(139,92,246,0.14), transparent 60%), rgba(255,255,255,0.015)" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "1.2rem", minWidth: 0 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: "1.35rem", fontWeight: 750, letterSpacing: "-0.01em" }}>Nothing saved yet</h3>
          <p style={{ margin: "0.45rem 0 0", fontSize: "0.88rem", color: C.muted, lineHeight: 1.6, maxWidth: 520 }}>
            When your app keeps track of things — sign-ups, orders, messages — you&rsquo;ll see them here and can edit them. Pick one to have SOL set it up:
          </p>
        </div>
        {onAskAi && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10 }}>
            {DATA_IDEAS.map(({ icon: Icon, color, title, prompt }) => (
              <button key={title} type="button" className="plx-data-idea" onClick={() => onAskAi(prompt)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "0.8rem 0.9rem", borderRadius: 14, border: `1px solid ${C.border}`, background: "rgba(255,255,255,0.03)", color: C.text, textAlign: "left", cursor: "pointer", fontFamily: "inherit" }}>
                <span style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0, display: "grid", placeItems: "center", background: `${color}26`, color }}>
                  <Icon size={17} />
                </span>
                <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>{title}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <DataIllustration />
    </section>
  );
}

/** A friendly picture of a filled-in table. */
function DataIllustration() {
  const rows = [
    { c: "#8b5cf6", w: ["58%", "34%"] },
    { c: "#c084fc", w: ["44%", "48%"] },
    { c: "#a78bfa", w: ["66%", "26%"] },
    { c: "#6366f1", w: ["50%", "40%"] },
  ];
  return (
    <div aria-hidden className="plx-data-art" style={{ borderRadius: 16, background: "rgba(11,15,25,0.6)", border: `1px solid ${C.borderStrong}`, padding: 16, display: "flex", flexDirection: "column", gap: 10, boxShadow: "0 24px 60px rgba(0,0,0,0.35)", transform: "rotate(-1.5deg)" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", paddingBottom: 8, borderBottom: `1px solid ${C.border}` }}>
        <span style={{ width: 70, height: 8, borderRadius: 99, background: "rgba(255,255,255,0.35)" }} />
        <span style={{ marginLeft: "auto", width: 46, height: 18, borderRadius: 6, background: C.brand }} />
      </div>
      {rows.map((row, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 26, height: 26, borderRadius: 99, background: row.c, flexShrink: 0 }} />
          <span style={{ width: row.w[0], height: 7, borderRadius: 99, background: "rgba(255,255,255,0.28)" }} />
          <span style={{ marginLeft: "auto", width: row.w[1], maxWidth: 80, height: 7, borderRadius: 99, background: "rgba(255,255,255,0.12)" }} />
        </div>
      ))}
    </div>
  );
}

/** First load: the shape of the page, gently pulsing. */
function DataSkeleton() {
  const block = (h: number, w: string = "100%") => <span className="plx-skel" style={{ display: "block", height: h, width: w, borderRadius: 8 }} />;
  return (
    <div className="plx-db-layout" aria-busy="true" aria-label="Loading your data">
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 14, padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        {[70, 55, 80, 60].map((w, i) => <span key={i}>{block(14, `${w}%`)}</span>)}
      </div>
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 14, padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
        {block(30, "40%")}
        {[0, 1, 2, 3, 4, 5].map((i) => <span key={i}>{block(18)}</span>)}
      </div>
    </div>
  );
}

/** Couldn't reach the data at all: say so plainly, with a way forward. */
function DataProblem({ message, onRetry }: { message: string; onRetry: () => void }) {
  const waking = message.startsWith(WAKING_MESSAGE);
  return (
    <section style={{ display: "flex", alignItems: "center", gap: "1.2rem", flexWrap: "wrap", padding: "1.8rem 2rem", borderRadius: 20, border: `1px solid ${waking ? "rgba(139,92,246,0.3)" : "rgba(251,191,36,0.3)"}`, background: waking ? "rgba(139,92,246,0.06)" : "rgba(251,191,36,0.05)" }}>
      <span style={{ width: 48, height: 48, borderRadius: 14, display: "grid", placeItems: "center", background: waking ? "rgba(139,92,246,0.16)" : "rgba(251,191,36,0.14)", color: waking ? "#c4b5fd" : C.warning, flexShrink: 0 }}>
        {waking ? <LoaderCircle size={22} className="plx-spin" /> : <CloudOff size={22} />}
      </span>
      <div style={{ flex: "1 1 320px", minWidth: 0 }}>
        <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700 }}>{waking ? "Waking up your data…" : "We couldn't open your app's data just now"}</h3>
        <p style={{ margin: "0.3rem 0 0", fontSize: "0.84rem", color: C.muted, lineHeight: 1.55 }}>
          {waking ? "This takes a few seconds the first time after a quiet spell." : `${message} Nothing is lost — your app's data is safe.`}
        </p>
      </div>
      <Button variant="primary" onClick={onRetry}>
        <RefreshCw size={14} /> Try again
      </Button>
    </section>
  );
}

const RESPONSIVE_CSS = `
.plx-skel { background: linear-gradient(90deg, rgba(255,255,255,0.04), rgba(255,255,255,0.09), rgba(255,255,255,0.04)); background-size: 200% 100%; animation: plx-shimmer 1.4s ease-in-out infinite; }
@keyframes plx-shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
.plx-data-idea { transition: border-color 0.15s, background 0.15s, transform 0.15s; }
.plx-data-idea:hover { border-color: rgba(139,92,246,0.5) !important; background: rgba(139,92,246,0.08) !important; transform: translateY(-1px); }
@media (max-width: 1000px) { .plx-data-empty { grid-template-columns: minmax(0, 1fr) !important; } .plx-data-art { display: none !important; } }
@media (prefers-reduced-motion: reduce) { .plx-skel { animation: none; } .plx-data-idea:hover { transform: none; } }
.plx-db-layout { display: grid; grid-template-columns: 230px minmax(0, 1fr); gap: 0.85rem; align-items: start; }
@media (max-width: 900px) { .plx-db-layout { grid-template-columns: minmax(0, 1fr); } }
.plx-db-cell:focus-visible, .plx-db-th:focus-visible { outline: 2px solid ${C.brand}; outline-offset: -2px; }
.plx-db-row:hover td { background: rgba(255,255,255,0.025); }
@keyframes plx-spin { to { transform: rotate(360deg); } }
.plx-spin { animation: plx-spin 0.9s linear infinite; }
`;

export function DatabasePane(props: { appId: string; refreshKey?: number; onAskAi?: (text: string) => void }) {
  const { appId, refreshKey, onAskAi } = props;
  const [env, setEnv] = useState<AppEnv>("dev");
  const [tab, setTab] = useState<"tables" | "sql">("tables");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [waking, setWaking] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const seq = useRef(0);

  const loadOverview = useCallback(async () => {
    const mine = ++seq.current;
    setLoadingOverview(true);
    setOverviewError(null);
    try {
      const data = await withWake(() => api<Overview>(`/api/v1/apps/${appId}/db?env=${env}`), setWaking);
      if (mine !== seq.current) return;
      setOverview(data);
      setSelected((cur) => (cur && data.tables.some((t) => t.name === cur) ? cur : (data.tables[0]?.name ?? null)));
    } catch (err) {
      if (mine === seq.current) setOverviewError(errorText(err));
    } finally {
      if (mine === seq.current) setLoadingOverview(false);
    }
  }, [appId, env]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview, refreshKey]);

  const changeEnv = (next: AppEnv) => {
    if (next === env) return;
    setOverview(null);
    setSelected(null);
    setEnv(next);
  };

  const refreshAll = () => {
    void loadOverview();
    setReloadTick((t) => t + 1);
  };

  const findings = (overview?.findings ?? []).filter((f) => !dismissed.has(`${env}:${f.table}:${f.message}`));
  const table = overview?.tables.find((t) => t.name === selected) ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem", color: C.text, minWidth: 0 }}>
      <style>{RESPONSIVE_CSS}</style>

      <PaneHeader
        title="Data"
        subtitle={env === "dev" ? "Everything your app saves while you test it in Preview." : "Everything your live app has saved for real visitors."}
        actions={
          <>
            <div role="tablist" aria-label="Data view" style={{ display: "inline-flex", gap: "0.25rem" }}>
              {(["tables", "sql"] as const).map((t) => (
                <Button key={t} role="tab" aria-selected={tab === t} size="sm" variant={tab === t ? "secondary" : "ghost"} onClick={() => setTab(t)}>
                  {t === "tables" ? "Browse" : "Advanced"}
                </Button>
              ))}
            </div>
            <EnvSwitch value={env} onChange={changeEnv} />
            <Button size="sm" variant="ghost" onClick={refreshAll} disabled={loadingOverview} aria-label="Refresh">
              <RefreshCw size={13} className={loadingOverview ? "plx-spin" : undefined} />
            </Button>
          </>
        }
      />

      {env === "live" && (
        <Notice tone="warning">
          You&apos;re looking at the live database. Changes here affect your real users&apos; data straight away.
        </Notice>
      )}
      {waking && <Notice tone="info">{WAKING_MESSAGE}</Notice>}
      {overviewError && overview && (
        <Notice tone="danger">
          {overviewError}{" "}
          <Button size="sm" variant="ghost" onClick={() => void loadOverview()} style={{ padding: "0 0.3rem" }}>
            Try again
          </Button>
        </Notice>
      )}

      {findings.length > 0 && (
        <ul aria-label="Security findings" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "0.45rem" }}>
          {findings.map((f) => {
            const id = `${env}:${f.table}:${f.message}`;
            return (
              <li key={id}>
                <Notice tone={f.level}>
                  <div style={{ display: "flex", gap: "0.6rem", alignItems: "flex-start" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>{f.message}</div>
                      <div style={{ color: C.muted, marginTop: "0.2rem", wordBreak: "break-word" }}>
                        <span style={{ fontWeight: 600 }}>Fix: </span>
                        <span style={{ fontFamily: C.mono, fontSize: "0.72rem" }}>{f.fix}</span>
                      </div>
                    </div>
                    {onAskAi && (
                      <Button size="sm" onClick={() => onAskAi(`Fix this database security issue: ${f.message} Suggested fix: ${f.fix}`)}>
                        <MessageSquare size={12} /> Ask SOL to fix
                      </Button>
                    )}
                    <button
                      type="button"
                      aria-label="Dismiss"
                      onClick={() => setDismissed((s) => new Set(s).add(id))}
                      style={{ background: "transparent", border: "none", color: C.muted, cursor: "pointer", padding: 2 }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                </Notice>
              </li>
            );
          })}
        </ul>
      )}

      {tab === "tables" && !overview && overviewError ? (
        <DataProblem message={overviewError} onRetry={() => void loadOverview()} />
      ) : tab === "tables" && !overview ? (
        <DataSkeleton />
      ) : tab === "tables" && overview && overview.tables.length === 0 ? (
        <DataEmpty onAskAi={onAskAi} />
      ) : tab === "tables" ? (
        <div className="plx-db-layout">
          <TableList tables={overview?.tables ?? null} loading={loadingOverview && !overview} selected={selected} onSelect={setSelected} />
          {table ? (
            <TableGrid key={`${env}:${table.name}`} appId={appId} env={env} table={table} reloadTick={reloadTick + (refreshKey ?? 0)} setWaking={setWaking} />
          ) : (
            overview &&
            overview.tables.length > 0 && (
              <Panel>
                <Empty title="Pick a table">Choose a table on the left to see its rows.</Empty>
              </Panel>
            )
          )}
        </div>
      ) : (
        <SqlTab appId={appId} env={env} migrations={overview?.migrations ?? null} onSchemaChanged={() => void loadOverview()} setWaking={setWaking} />
      )}
    </div>
  );
}

function TableList(props: { tables: TableOverview[] | null; loading: boolean; selected: string | null; onSelect: (name: string) => void }) {
  const { tables, loading, selected, onSelect } = props;
  return (
    <Panel title="Tables" style={{ padding: "0.85rem 0.6rem" }}>
      {loading ? (
        <p style={{ color: C.muted, fontSize: "0.78rem", margin: "0.5rem" }}>Loading tables…</p>
      ) : !tables || tables.length === 0 ? (
        <Empty title="Nothing here yet">Ask SOL to add something for your app to keep track of.</Empty>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          {tables.map((t) => {
            const active = t.name === selected;
            return (
              <li key={t.name}>
                <button
                  type="button"
                  aria-current={active ? "true" : undefined}
                  onClick={() => onSelect(t.name)}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.45rem",
                    padding: "0.45rem 0.55rem",
                    borderRadius: 8,
                    border: "none",
                    cursor: "pointer",
                    textAlign: "left",
                    background: active ? "rgba(139,92,246,0.18)" : "transparent",
                    color: active ? C.text : C.muted,
                    fontSize: "0.8rem",
                  }}
                >
                  <Table2 size={13} style={{ flexShrink: 0 }} />
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: C.mono }}>{t.name}</span>
                  <span style={{ fontSize: "0.7rem", color: C.faint }} title="Approximate number of rows">
                    {t.kind === "view" ? "view" : `~${t.rowEstimate.toLocaleString()}`}
                  </span>
                  {t.kind === "table" &&
                    (t.rls ? (
                      <span title="Protected: row-level security is on" aria-label="Protected" style={{ display: "inline-flex", color: C.success }}>
                        <Lock size={12} />
                      </span>
                    ) : (
                      <span title="Unprotected: anyone can read and change every row" aria-label="Unprotected" style={{ display: "inline-flex", color: C.danger }}>
                        <TriangleAlert size={12} />
                      </span>
                    ))}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

const thStyle: CSSProperties = {
  position: "sticky",
  top: 0,
  background: C.panelSolid,
  textAlign: "left",
  padding: "0.45rem 0.6rem",
  fontWeight: 600,
  fontSize: "0.74rem",
  color: C.muted,
  borderBottom: `1px solid ${C.borderStrong}`,
  whiteSpace: "nowrap",
  zIndex: 1,
};
const tdStyle: CSSProperties = {
  padding: "0.38rem 0.6rem",
  borderBottom: `1px solid ${C.border}`,
  fontSize: "0.76rem",
  fontFamily: C.mono,
  maxWidth: 280,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  verticalAlign: "top",
};
const badge = (color: string): CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  gap: 2,
  fontSize: "0.6rem",
  fontWeight: 700,
  padding: "0 0.3rem",
  borderRadius: 4,
  background: `${color}22`,
  color,
  marginLeft: 4,
});

function TableGrid(props: { appId: string; env: AppEnv; table: TableOverview; reloadTick: number; setWaking: (v: boolean) => void }) {
  const { appId, env, table, reloadTick, setWaking } = props;
  const [page, setPage] = useState(0);
  const [order, setOrder] = useState<{ col: string; dir: "asc" | "desc" } | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [data, setData] = useState<RowsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ key: string; col: string; draft: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [showPolicies, setShowPolicies] = useState(false);
  const [tick, setTick] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    const q = new URLSearchParams({ env, table: table.name, limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
    if (order) q.set("order", `${order.col}.${order.dir}`);
    if (search) q.set("search", search);
    withWake(() => api<RowsResponse>(`/api/v1/apps/${appId}/db/rows?${q}`), setWaking)
      .then((res) => {
        if (mine !== seq.current) return;
        setData(res);
        setChecked(new Set());
        setEditing(null);
      })
      .catch((err) => mine === seq.current && setError(errorText(err)))
      .finally(() => mine === seq.current && setLoading(false));
  }, [appId, env, table.name, page, order, search, reloadTick, tick, setWaking]);

  const pk = data?.primaryKey ?? table.columns.filter((c) => c.primaryKey).map((c) => c.name);
  const editable = table.kind === "table" && pk.length > 0;
  const rows = data?.rows ?? [];
  const total = data?.total ?? null;
  const pageCount = total !== null ? Math.max(1, Math.ceil(total / PAGE_SIZE)) : null;
  const colByName = useMemo(() => new Map(table.columns.map((c) => [c.name, c])), [table.columns]);

  const toggleSort = (col: string) => {
    setPage(0);
    setOrder((cur) => (cur?.col !== col ? { col, dir: "asc" } : cur.dir === "asc" ? { col, dir: "desc" } : null));
  };

  const saveCell = async (row: Row, col: string, value: unknown) => {
    setSaving(true);
    setActionError(null);
    try {
      const res = await withWake(
        () => api<{ rows: Row[] }>(`/api/v1/apps/${appId}/db/rows?env=${env}`, { method: "PATCH", json: { table: table.name, key: keyObject(row, pk), values: { [col]: value } } }),
        setWaking,
      );
      const updated = res.rows?.[0];
      const k = rowKey(row, pk);
      setData((d) => (d ? { ...d, rows: d.rows.map((r) => (rowKey(r, pk) === k ? (updated ?? { ...r, [col]: value }) : r)) } : d));
      setEditing(null);
    } catch (err) {
      setActionError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  const commitEdit = (row: Row) => {
    if (!editing || saving) return;
    const column = colByName.get(editing.col);
    if (!column) return;
    let value: unknown;
    try {
      value = parseDraft(editing.draft, column);
    } catch (err) {
      setActionError((err as Error).message);
      return;
    }
    if (formatCell(value) === formatCell(row[editing.col]) && (value === null) === (row[editing.col] === null)) {
      setEditing(null);
      return;
    }
    void saveCell(row, editing.col, value);
  };

  const startEdit = (row: Row, col: string) => {
    if (!editable) return;
    const column = colByName.get(col);
    if (!column) return;
    setActionError(null);
    setEditing({ key: rowKey(row, pk), col, draft: toDraft(row[col], editorKind(column.type)) });
  };

  const deleteChecked = async () => {
    const keys = rows.filter((r) => checked.has(rowKey(r, pk))).map((r) => keyObject(r, pk));
    if (!keys.length) return;
    const msg = `Delete ${keys.length} row${keys.length === 1 ? "" : "s"} from "${table.name}"${env === "live" ? " in your LIVE database" : ""}? This can't be undone.`;
    if (!window.confirm(msg)) return;
    setDeleting(true);
    setActionError(null);
    try {
      await withWake(() => api(`/api/v1/apps/${appId}/db/rows?env=${env}`, { method: "DELETE", json: { table: table.name, keys } }), setWaking);
      setTick((t) => t + 1);
    } catch (err) {
      setActionError(errorText(err));
    } finally {
      setDeleting(false);
    }
  };

  const allChecked = rows.length > 0 && rows.every((r) => checked.has(rowKey(r, pk)));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.7rem", minWidth: 0 }}>
      <Panel style={{ padding: "0.85rem 0.9rem" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center", marginBottom: "0.7rem" }}>
          <h3 style={{ margin: 0, fontSize: "0.92rem", fontFamily: C.mono, flex: "1 1 auto" }}>{table.name}</h3>
          <div style={{ position: "relative", flex: "0 1 220px", minWidth: 150 }}>
            <Search size={13} style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: C.faint }} aria-hidden />
            <input
              type="search"
              aria-label={`Search ${table.name}`}
              placeholder="Search text columns…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              style={{ ...inputStyle, paddingLeft: "1.8rem", padding: "0.38rem 0.6rem 0.38rem 1.8rem" }}
            />
          </div>
          {editable && (
            <>
              {checked.size > 0 && (
                <Button size="sm" variant="danger" onClick={() => void deleteChecked()} disabled={deleting}>
                  <Trash2 size={12} /> {deleting ? "Deleting…" : `Delete ${checked.size}`}
                </Button>
              )}
              <Button size="sm" variant="primary" onClick={() => setAdding((a) => !a)} aria-expanded={adding}>
                <Plus size={12} /> Add row
              </Button>
            </>
          )}
        </div>

        {!editable && (
          <div style={{ marginBottom: "0.7rem" }}>
            <Notice tone="info">
              {table.kind === "view"
                ? "This is a view — a saved query over other tables — so its rows are read-only here. Edit the tables it reads from instead."
                : "This table has no primary key (a column that uniquely identifies each row), so rows can't be safely edited or deleted here. Ask SOL to add an id column to make it editable."}
            </Notice>
          </div>
        )}
        {actionError && (
          <div style={{ marginBottom: "0.7rem" }}>
            <Notice tone="danger">{actionError}</Notice>
          </div>
        )}
        {adding && editable && (
          <AddRowForm
            appId={appId}
            env={env}
            table={table}
            setWaking={setWaking}
            onCancel={() => setAdding(false)}
            onAdded={() => {
              setAdding(false);
              setTick((t) => t + 1);
            }}
          />
        )}

        {error ? (
          <Notice tone="danger">
            {error}{" "}
            <Button size="sm" variant="ghost" onClick={() => setTick((t) => t + 1)} style={{ padding: "0 0.3rem" }}>
              Try again
            </Button>
          </Notice>
        ) : (
          <div style={{ overflow: "auto", maxHeight: 520, border: `1px solid ${C.border}`, borderRadius: 10, position: "relative", opacity: loading && data ? 0.6 : 1 }} aria-busy={loading}>
            <table style={{ borderCollapse: "separate", borderSpacing: 0, width: "100%", minWidth: "max-content" }}>
              <thead>
                <tr>
                  {editable && (
                    <th style={{ ...thStyle, width: 34 }}>
                      <input
                        type="checkbox"
                        aria-label="Select all rows on this page"
                        checked={allChecked}
                        onChange={() => setChecked(allChecked ? new Set() : new Set(rows.map((r) => rowKey(r, pk))))}
                      />
                    </th>
                  )}
                  {table.columns.map((c) => {
                    const sorted = order?.col === c.name ? order.dir : null;
                    return (
                      <th key={c.name} style={thStyle} aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none"}>
                        <button
                          type="button"
                          className="plx-db-th"
                          onClick={() => toggleSort(c.name)}
                          title={`${c.type}${c.nullable ? "" : " · required"}${c.hasDefault ? " · has a default" : ""}${c.references ? ` · links to ${c.references}` : ""} — click to sort`}
                          style={{ background: "none", border: "none", color: "inherit", font: "inherit", cursor: "pointer", padding: 0, display: "inline-flex", alignItems: "center" }}
                        >
                          <span style={{ fontFamily: C.mono }}>{c.name}</span>
                          {c.primaryKey && (
                            <span style={badge(C.warning)} title="Primary key — uniquely identifies each row">
                              <KeyRound size={9} /> PK
                            </span>
                          )}
                          {c.references && (
                            <span style={badge(C.brand)} title={`Links to ${c.references}`}>
                              <Link2 size={9} /> FK
                            </span>
                          )}
                          {sorted && <span style={{ marginLeft: 4 }}>{sorted === "asc" ? "▲" : "▼"}</span>}
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const k = editable ? rowKey(row, pk) : "";
                  return (
                    <tr key={editable ? k : JSON.stringify(row)} className="plx-db-row">
                      {editable && (
                        <td style={{ ...tdStyle, width: 34 }}>
                          <input
                            type="checkbox"
                            aria-label="Select row"
                            checked={checked.has(k)}
                            onChange={() =>
                              setChecked((s) => {
                                const n = new Set(s);
                                if (n.has(k)) n.delete(k);
                                else n.add(k);
                                return n;
                              })
                            }
                          />
                        </td>
                      )}
                      {table.columns.map((c) => {
                        const isEditing = editing && editing.key === k && editing.col === c.name;
                        const v = row[c.name];
                        if (isEditing) {
                          return (
                            <td key={c.name} style={{ ...tdStyle, overflow: "visible", maxWidth: "none" }}>
                              <CellEditor
                                column={c}
                                draft={editing.draft}
                                saving={saving}
                                onDraft={(draft) => setEditing((e) => (e ? { ...e, draft } : e))}
                                onCommit={() => commitEdit(row)}
                                onCommitValue={(value) => void saveCell(row, c.name, value)}
                                onCancel={() => setEditing(null)}
                              />
                            </td>
                          );
                        }
                        return (
                          <td
                            key={c.name}
                            className="plx-db-cell"
                            tabIndex={editable ? 0 : undefined}
                            title={editable ? `${formatCell(v)}\n\nDouble-click to edit` : formatCell(v)}
                            onDoubleClick={() => startEdit(row, c.name)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") startEdit(row, c.name);
                            }}
                            style={{ ...tdStyle, color: v === null || v === undefined ? C.faint : C.text, cursor: editable ? "cell" : "default" }}
                          >
                            {formatCell(v)}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!loading && rows.length === 0 && (
              <Empty title={search ? "No matching rows" : "This table is empty"}>
                {search ? "Try a different search." : editable ? "Rows appear here as people use your app — or add one with “Add row”." : "Rows appear here as people use your app."}
              </Empty>
            )}
            {loading && !data && <p style={{ color: C.muted, fontSize: "0.78rem", padding: "1rem" }}>Loading rows…</p>}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem", marginTop: "0.6rem", flexWrap: "wrap", fontSize: "0.74rem", color: C.muted }}>
          <span>
            {total === null
              ? ""
              : total === 0
                ? "0 rows"
                : `Rows ${(page * PAGE_SIZE + 1).toLocaleString()}–${Math.min(total, (page + 1) * PAGE_SIZE).toLocaleString()} of ${total.toLocaleString()}`}
            {editable && rows.length > 0 && <span style={{ color: C.faint }}> · Double-click a cell to edit</span>}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
            <Button size="sm" variant="ghost" aria-label="Previous page" disabled={page === 0 || loading} onClick={() => setPage((p) => Math.max(0, p - 1))}>
              <ChevronLeft size={13} />
            </Button>
            <span>
              Page {page + 1}
              {pageCount ? ` of ${pageCount}` : ""}
            </span>
            <Button size="sm" variant="ghost" aria-label="Next page" disabled={loading || (pageCount !== null ? page + 1 >= pageCount : rows.length < PAGE_SIZE)} onClick={() => setPage((p) => p + 1)}>
              <ChevronRight size={13} />
            </Button>
          </div>
        </div>
      </Panel>

      {table.kind === "table" && (
        <Panel style={{ padding: "0.7rem 0.9rem" }}>
          <button
            type="button"
            aria-expanded={showPolicies}
            onClick={() => setShowPolicies((s) => !s)}
            style={{ background: "none", border: "none", color: C.text, cursor: "pointer", padding: 0, display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.84rem", fontWeight: 600, width: "100%" }}
          >
            {showPolicies ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            Who can access this
            <span style={{ color: C.faint, fontWeight: 400, fontSize: "0.74rem" }}>
              {!table.rls ? "— everyone (unprotected)" : table.policies.length ? `— ${table.policies.length} rule${table.policies.length === 1 ? "" : "s"}` : "— only your server code"}
            </span>
          </button>
          {showPolicies && <PolicyList table={table} />}
        </Panel>
      )}
    </div>
  );
}

function PolicyList({ table }: { table: TableOverview }) {
  if (!table.rls) {
    return (
      <p style={{ fontSize: "0.78rem", color: C.danger, margin: "0.6rem 0 0" }}>
        Row-level security is off, so anyone using your app can read and change every row. Turn it on and add rules for who may do what.
      </p>
    );
  }
  if (!table.policies.length) {
    return (
      <p style={{ fontSize: "0.78rem", color: C.muted, margin: "0.6rem 0 0" }}>
        No rules yet, so visitors can&apos;t read or change this table from the app. Your app&apos;s server functions (and you, here) still can.
      </p>
    );
  }
  const roleLabel = (r: string) => (r === "plexo_anon" ? "signed-out visitors" : r === "plexo_authenticated" ? "signed-in users" : r === "public" ? "everyone" : r);
  return (
    <ul style={{ listStyle: "none", margin: "0.6rem 0 0", padding: 0, display: "flex", flexDirection: "column", gap: "0.45rem" }}>
      {table.policies.map((p) => (
        <li key={p.name} style={{ border: `1px solid ${C.border}`, borderRadius: 9, padding: "0.5rem 0.65rem", fontSize: "0.76rem" }}>
          <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", alignItems: "baseline" }}>
            <span style={{ fontWeight: 600 }}>{p.name}</span>
            <span style={badge(C.brand)}>{p.command === "all" ? "ALL ACTIONS" : p.command.toUpperCase()}</span>
            <span style={{ color: C.muted }}>for {p.roles.map(roleLabel).join(", ")}</span>
          </div>
          {p.using && (
            <div style={{ marginTop: "0.3rem", color: C.muted }}>
              Which rows: <code style={{ fontFamily: C.mono, color: C.text, wordBreak: "break-word" }}>{p.using}</code>
            </div>
          )}
          {p.check && (
            <div style={{ marginTop: "0.2rem", color: C.muted }}>
              New or changed rows must match: <code style={{ fontFamily: C.mono, color: C.text, wordBreak: "break-word" }}>{p.check}</code>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function CellEditor(props: {
  column: Column;
  draft: string;
  saving: boolean;
  onDraft: (v: string) => void;
  onCommit: () => void;
  onCommitValue: (v: unknown) => void;
  onCancel: () => void;
}) {
  const { column, draft, saving, onDraft, onCommit, onCommitValue, onCancel } = props;
  const kind = editorKind(column.type);
  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    } else if (e.key === "Enter" && (kind === "text" || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onCommit();
    }
  };
  const nullButton = column.nullable ? (
    <Button size="sm" variant="ghost" disabled={saving} onClick={() => onCommitValue(null)} title="Clear this value (set to NULL)">
      NULL
    </Button>
  ) : null;

  if (kind === "boolean") {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
        <input type="checkbox" autoFocus aria-label={column.name} checked={draft === "true"} disabled={saving} onChange={(e) => onCommitValue(e.target.checked)} onKeyDown={onKey} />
        {nullButton}
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </span>
    );
  }
  if (kind === "json") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", minWidth: 260 }}>
        <textarea
          autoFocus
          aria-label={`${column.name} (JSON)`}
          value={draft}
          rows={Math.min(10, Math.max(3, draft.split("\n").length))}
          onChange={(e) => onDraft(e.target.value)}
          onKeyDown={onKey}
          disabled={saving}
          style={{ ...inputStyle, fontFamily: C.mono, fontSize: "0.74rem", resize: "vertical" }}
        />
        <div style={{ display: "flex", gap: "0.3rem" }}>
          <Button size="sm" variant="primary" disabled={saving} onClick={onCommit}>
            {saving ? "Saving…" : "Save"}
          </Button>
          {nullButton}
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
      <input
        autoFocus
        aria-label={column.name}
        value={draft}
        onChange={(e) => onDraft(e.target.value)}
        onKeyDown={onKey}
        onBlur={(e) => {
          // Clicking the NULL/Cancel buttons beside the input shouldn't save first.
          if (!(e.relatedTarget instanceof HTMLElement && e.currentTarget.parentElement?.contains(e.relatedTarget))) onCommit();
        }}
        disabled={saving}
        style={{ ...inputStyle, padding: "0.25rem 0.45rem", fontFamily: C.mono, fontSize: "0.76rem", minWidth: 160 }}
      />
      {saving ? <LoaderCircle size={13} className="plx-spin" /> : nullButton}
    </span>
  );
}

function AddRowForm(props: { appId: string; env: AppEnv; table: TableOverview; setWaking: (v: boolean) => void; onCancel: () => void; onAdded: () => void }) {
  const { appId, env, table, setWaking, onCancel, onAdded } = props;
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const row: Row = {};
    try {
      for (const c of table.columns) {
        const raw = values[c.name];
        if (raw === undefined || raw === "") {
          if (!c.nullable && !c.hasDefault) throw new Error(`"${c.name}" is required.`);
          continue;
        }
        if (editorKind(c.type) === "boolean") row[c.name] = raw === "true";
        else row[c.name] = parseDraft(raw, c);
      }
    } catch (err) {
      setError((err as Error).message);
      return;
    }
    setSaving(true);
    try {
      await withWake(() => api(`/api/v1/apps/${appId}/db/rows?env=${env}`, { method: "POST", json: { table: table.name, rows: [row] } }), setWaking);
      onAdded();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} style={{ border: `1px solid ${C.borderStrong}`, borderRadius: 10, padding: "0.75rem", marginBottom: "0.75rem", display: "flex", flexDirection: "column", gap: "0.6rem" }}>
      <div style={{ fontSize: "0.82rem", fontWeight: 600 }}>New row in {table.name}</div>
      <p style={{ margin: 0, fontSize: "0.74rem", color: C.muted }}>Leave a field blank to use its default (like an automatic id or timestamp).</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "0.6rem" }}>
        {table.columns.map((c) => {
          const kind = editorKind(c.type);
          const hint = c.hasDefault ? "automatic if blank" : c.nullable ? "optional" : "required";
          const id = `add-${table.name}-${c.name}`;
          return (
            <label key={c.name} htmlFor={id} style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.74rem", color: C.muted, gridColumn: kind === "json" ? "1 / -1" : undefined }}>
              <span>
                <span style={{ fontFamily: C.mono, color: C.text }}>{c.name}</span> <span style={{ color: C.faint }}>({c.type} · {hint})</span>
              </span>
              {kind === "boolean" ? (
                <select id={id} value={values[c.name] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [c.name]: e.target.value }))} style={inputStyle}>
                  <option value="">{c.hasDefault ? "Default" : "Not set"}</option>
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              ) : kind === "json" ? (
                <textarea
                  id={id}
                  rows={3}
                  placeholder='{"key": "value"}'
                  value={values[c.name] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [c.name]: e.target.value }))}
                  style={{ ...inputStyle, fontFamily: C.mono, resize: "vertical" }}
                />
              ) : (
                <input id={id} value={values[c.name] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [c.name]: e.target.value }))} style={inputStyle} />
              )}
            </label>
          );
        })}
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
      <div style={{ display: "flex", gap: "0.4rem" }}>
        <Button type="submit" variant="primary" size="sm" disabled={saving}>
          {saving ? "Adding…" : "Add row"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function SqlTab(props: { appId: string; env: AppEnv; migrations: Array<{ name: string; appliedAt: string }> | null; onSchemaChanged: () => void; setWaking: (v: boolean) => void }) {
  const { appId, env, migrations, onSchemaChanged, setWaking } = props;
  const [sql, setSql] = useState("select * from information_schema.tables where table_schema = 'public';");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SqlResult | null>(null);
  const [error, setError] = useState<{ message: string; line?: number; hint?: string } | null>(null);
  const sqlRef = useRef(sql);
  sqlRef.current = sql;
  const seq = useRef(0);
  ensureMonaco();

  // Results belong to the database they ran against.
  useEffect(() => {
    seq.current++;
    setResult(null);
    setError(null);
    setRunning(false);
  }, [env]);

  const run = useCallback(async () => {
    const text = sqlRef.current;
    if (!text.trim()) return;
    if (env === "live" && /\b(insert|update|delete|drop|alter|truncate|create)\b/i.test(text) && !window.confirm("This will change your LIVE database, used by real people. Run it?")) return;
    const mine = ++seq.current;
    setRunning(true);
    setError(null);
    try {
      const res = await withWake(() => api<SqlResult>(`/api/v1/apps/${appId}/db/sql?env=${env}`, { method: "POST", json: { sql: text } }), setWaking);
      if (mine !== seq.current) return;
      setResult(res);
      if (/\b(create|alter|drop)\b/i.test(text)) onSchemaChanged();
    } catch (err) {
      if (mine !== seq.current) return;
      setResult(null);
      if (err instanceof ApiError && err.status !== 503) {
        const line = typeof err.extra?.line === "number" ? err.extra.line : undefined;
        setError({ message: err.message, line, hint: err.hint });
      } else setError({ message: errorText(err) });
    } finally {
      if (mine === seq.current) setRunning(false);
    }
  }, [appId, env, onSchemaChanged, setWaking]);

  const runRef = useRef(run);
  runRef.current = run;

  const onMount: OnMount = (editor, monaco) => {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => void runRef.current());
  };

  const fields = result?.fields.length ? result.fields.map((f) => f.name) : Object.keys(result?.rows[0] ?? {});

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem", minWidth: 0 }}>
      <Panel
        title="SQL editor"
        actions={
          <Button size="sm" variant="primary" onClick={() => void run()} disabled={running} title="Run (⌘/Ctrl + Enter)">
            {running ? <LoaderCircle size={12} className="plx-spin" /> : <Play size={12} />} {running ? "Running…" : "Run"}
          </Button>
        }
      >
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
          <Editor
            height={200}
            language="sql"
            theme={EDITOR_THEME}
            value={sql}
            onChange={(v) => setSql(v ?? "")}
            onMount={onMount}
            loading={<div style={{ color: C.muted, fontSize: "0.78rem", padding: "1rem" }}>Loading editor…</div>}
            options={{ minimap: { enabled: false }, fontSize: 13, scrollBeyondLastLine: false, wordWrap: "on", lineNumbers: "on", automaticLayout: true, tabSize: 2 }}
          />
        </div>
        <p style={{ margin: "0.55rem 0 0", fontSize: "0.74rem", color: C.muted, lineHeight: 1.5 }}>
          Runs as the app&apos;s owner. For lasting changes, add a migration file so they reach the live database when you publish.{" "}
          <span style={{ color: C.faint }}>Press ⌘/Ctrl + Enter to run.</span>
        </p>
      </Panel>

      {error && (
        <Notice tone="danger">
          <div style={{ fontWeight: 600 }}>
            {error.line ? `Line ${error.line}: ` : ""}
            {error.message}
          </div>
          {error.hint && <div style={{ color: C.muted, marginTop: "0.2rem" }}>{error.hint}</div>}
        </Notice>
      )}

      {result && (
        <Panel
          title="Result"
          description={
            <>
              {result.command ? `${result.command} · ` : ""}
              {result.rowCount ?? result.rows.length} row{(result.rowCount ?? result.rows.length) === 1 ? "" : "s"} · {result.durationMs} ms
              {result.truncated && " · showing the first 1,000 rows"}
            </>
          }
        >
          {fields.length === 0 ? (
            <p style={{ margin: 0, fontSize: "0.78rem", color: C.muted }}>Done — the statement didn&apos;t return any rows.</p>
          ) : (
            <div style={{ overflow: "auto", maxHeight: 420, border: `1px solid ${C.border}`, borderRadius: 10 }}>
              <table style={{ borderCollapse: "separate", borderSpacing: 0, width: "100%", minWidth: "max-content" }}>
                <thead>
                  <tr>
                    {fields.map((f, i) => (
                      <th key={`${f}-${i}`} style={{ ...thStyle, fontFamily: C.mono }}>
                        {f}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((r, i) => (
                    <tr key={i} className="plx-db-row">
                      {fields.map((f, j) => (
                        <td key={`${f}-${j}`} title={formatCell(r[f])} style={{ ...tdStyle, color: r[f] === null || r[f] === undefined ? C.faint : C.text }}>
                          {formatCell(r[f])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {result.rows.length === 0 && <Empty title="No rows">The query ran but matched nothing.</Empty>}
            </div>
          )}
        </Panel>
      )}

      <Panel title="Migrations" description="Schema changes from your app's migration files, applied in order. Each one runs once per database.">
        {migrations === null ? (
          <p style={{ margin: 0, fontSize: "0.78rem", color: C.muted }}>Loading…</p>
        ) : migrations.length === 0 ? (
          <Empty title="No migrations applied yet">When SOL (or you) adds a file under the app&apos;s migrations folder, it&apos;s applied on the next build.</Empty>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {migrations.map((m) => (
              <li key={m.name} style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", padding: "0.4rem 0", borderBottom: `1px solid ${C.border}`, fontSize: "0.76rem" }}>
                <span style={{ fontFamily: C.mono, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name}</span>
                <span style={{ color: C.faint, whiteSpace: "nowrap" }} title={new Date(m.appliedAt).toLocaleString()}>
                  {timeAgo(m.appliedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
