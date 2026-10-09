"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Monitor, Tablet, Smartphone, MousePointerClick, RotateCw, ExternalLink, Link2, Rocket, MessageSquare, AppWindow, X, Wrench, Code2, Undo2, Eye } from "lucide-react";
import { SolChatView } from "../../sol/_components/SolChatView";
import type { ConversationSummary, SolMessage } from "../../sol/_components/types";
import { appsApi, pollBuild, ApiError, type AppSummary, type BuildReport, type BuildError } from "./api";
import { C, Button } from "./ui";
import { PreviewPane, type Viewport, type SelectedElement, type PreviewError } from "./PreviewPane";
import { CodePane } from "./CodePane";
import { DiffView } from "./DiffView";
import { DatabasePane } from "./DatabasePane";
import { UsersPane } from "./UsersPane";
import { FunctionsPane } from "./FunctionsPane";
import { SecretsPane } from "./SecretsPane";
import { SettingsPane } from "./SettingsPane";
import { HistoryPane } from "./HistoryPane";
import { PublishDialog } from "./PublishDialog";
import { GitHubPane } from "./GitHubPane";

type Tab = "preview" | "code" | "database" | "users" | "functions" | "secrets" | "history" | "github" | "settings";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "preview", label: "Preview" },
  { id: "code", label: "Code" },
  { id: "database", label: "Database" },
  { id: "users", label: "Users" },
  { id: "functions", label: "Functions" },
  { id: "secrets", label: "Secrets" },
  { id: "history", label: "History" },
  { id: "github", label: "GitHub" },
  { id: "settings", label: "Settings" },
];

// Tools whose completion means the preview (and the files/data panes) changed.
const REFRESHING_TOOLS = new Set(["app_build", "app_build_status", "app_restore_version", "app_publish", "app_sql", "app_update_auth_settings"]);

export function AppEditor(props: {
  appId: string;
  initialSummary: AppSummary;
  conversation: ConversationSummary;
  initialMessages: SolMessage[];
  userName: string | null;
  initialPrompt: string | null;
  initialPanel: string | null;
  addSecretName: string | null;
}) {
  const { appId } = props;
  const [summary, setSummary] = useState<AppSummary>(props.initialSummary);
  const [tab, setTab] = useState<Tab>((TABS.find((t) => t.id === props.initialPanel)?.id ?? "preview") as Tab);
  const [viewport, setViewport] = useState<Viewport>("desktop");
  const [route, setRoute] = useState("/");
  const [routeDraft, setRouteDraft] = useState("/");
  const [reloadKey, setReloadKey] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [inspecting, setInspecting] = useState(false);
  const [selected, setSelected] = useState<SelectedElement | null>(null);
  const [runtimeErrors, setRuntimeErrors] = useState<PreviewError[]>([]);
  const [build, setBuild] = useState<BuildReport | null>(null);
  const [building, setBuilding] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [diff, setDiff] = useState<{ versionId: string; against: string; title: string } | null>(null);
  const [codeOpen, setCodeOpen] = useState<{ path: string; line?: number; nonce: number } | null>(null);
  const [turnChange, setTurnChange] = useState<{ from: string; to: string } | null>(null);
  const [mobileView, setMobileView] = useState<"chat" | "app">("app");
  const [copied, setCopied] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const sendRef = useRef<((text: string) => void) | null>(null);
  const turnBaseVersion = useRef<string | null>(summary.headVersionId);
  const buildAbort = useRef<AbortController | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedRef = useRef<SelectedElement | null>(null);
  selectedRef.current = selected;

  const refreshSummary = useCallback(async () => {
    try {
      const next = await appsApi.summary(appId);
      setSummary(next);
      return next;
    } catch {
      return null;
    }
  }, [appId]);

  const flash = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 2600);
  };

  // ------------------------------------------------------------------ builds

  const runBuild = useCallback(
    async (message?: string) => {
      buildAbort.current?.abort();
      const controller = new AbortController();
      buildAbort.current = controller;
      setBuilding(true);
      try {
        const { buildId } = await appsApi.build(appId, message);
        const report = await pollBuild(appId, buildId, (r) => !controller.signal.aborted && setBuild(r), controller.signal);
        if (controller.signal.aborted) return;
        setBuild(report);
        if (report.status === "SUCCEEDED") {
          setRuntimeErrors([]);
          setReloadKey((k) => k + 1);
        }
        void refreshSummary();
      } catch (err) {
        if ((err as Error)?.name !== "AbortError") flash(err instanceof ApiError ? err.message : "The build couldn't start.");
      } finally {
        if (buildAbort.current === controller) setBuilding(false);
      }
    },
    [appId, refreshSummary],
  );

  // Code Mode saves → rebuild shortly after the typing stops.
  const onCodeSaved = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void runBuild("Edited in Code Mode"), 1200);
  }, [runBuild]);

  useEffect(() => {
    if (!summary.latestBuild && !building) void runBuild("First build");
    return () => buildAbort.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------------ SOL integration

  const onToolFinished = useCallback(
    (call: { name: string; status: string; result: unknown }) => {
      if (!REFRESHING_TOOLS.has(call.name)) return;
      setRefreshKey((k) => k + 1);
      const result = call.result as { ok?: boolean; pending?: boolean; buildId?: string } | undefined;
      if (call.name === "app_build" || call.name === "app_build_status" || call.name === "app_restore_version") {
        setReloadKey((k) => k + 1);
        setRuntimeErrors([]);
        if (result?.buildId) void appsApi.buildReport(appId, result.buildId).then(setBuild).catch(() => undefined);
      }
      void refreshSummary().then((next) => {
        // Offer a review of what this AI turn changed (and a one-click undo).
        if (next?.headVersionId && turnBaseVersion.current && next.headVersionId !== turnBaseVersion.current) {
          setTurnChange({ from: turnBaseVersion.current, to: next.headVersionId });
        }
      });
    },
    [appId, refreshSummary],
  );

  const transformOutgoing = useCallback(
    (text: string) => {
      turnBaseVersion.current = summary.headVersionId;
      setTurnChange(null);
      const el = selectedRef.current;
      if (!el) return text;
      setTimeout(() => setSelected(null), 0);
      const where = el.file ? `${el.file}${el.line ? `:${el.line}` : ""}` : "unknown file";
      return `${text}\n\n[Selected element: <${el.tag}> in ${where} on page ${el.path}${el.text ? ` — its text: "${el.text.slice(0, 160)}"` : ""}${el.classes ? ` — classes: "${el.classes.slice(0, 200)}"` : ""}. Change this element.]`;
    },
    [summary.headVersionId],
  );

  const sendToSol = useCallback((text: string) => {
    setMobileView("chat");
    sendRef.current?.(text);
  }, []);

  const fixWithAi = useCallback(
    (error: { message: string; stack?: string | null; url?: string | null; file?: string; line?: number }) => {
      const where = error.file ? `\nFile: ${error.file}${error.line ? `:${error.line}` : ""}` : "";
      sendToSol(`My app shows this error. Find the cause, fix it, rebuild and check it works:\n\n${error.message}${where}${error.stack ? `\n\n${error.stack.slice(0, 1500)}` : ""}${error.url ? `\n\nPage: ${error.url}` : ""}`);
    },
    [sendToSol],
  );

  // Opened from the new-app flow with the first request already typed.
  const sentInitial = useRef(false);
  useEffect(() => {
    if (!props.initialPrompt || sentInitial.current || props.initialMessages.length) return;
    const timer = setInterval(() => {
      if (sendRef.current) {
        clearInterval(timer);
        sentInitial.current = true;
        sendRef.current(props.initialPrompt!);
        window.history.replaceState(null, "", `/dashboard/apps/${appId}`);
      }
    }, 100);
    return () => clearInterval(timer);
  }, [props.initialPrompt, props.initialMessages.length, appId]);

  // ------------------------------------------------------------------ preview events

  const onPreviewError = useCallback((error: PreviewError) => {
    setRuntimeErrors((prev) => (prev.some((e) => e.message === error.message) ? prev : [...prev, error].slice(-20)));
  }, []);
  const onSelect = useCallback((element: SelectedElement) => {
    setSelected(element);
    setInspecting(false);
    setMobileView("chat");
  }, []);
  const onNavigate = useCallback((path: string) => {
    setRoute(path);
    setRouteDraft(path);
  }, []);

  const copyPreviewLink = async () => {
    if (!summary.previewUrl) return;
    await navigator.clipboard.writeText(summary.previewUrl).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const buildErrors: BuildError[] = build && !build.pending && build.status === "FAILED" ? build.errors : [];
  const statusPill = building || build?.pending
    ? { label: build?.status === "BUILDING" ? "Building…" : build?.status === "SUCCEEDED" ? "Finishing…" : "Starting build…", color: C.brand }
    : buildErrors.length || build?.migrations?.failed
      ? { label: `${buildErrors.length || 1} problem${buildErrors.length > 1 ? "s" : ""}`, color: C.danger }
      : build?.ok || summary.latestBuild
        ? { label: "Up to date", color: C.success }
        : { label: "Not built", color: C.faint };

  // ------------------------------------------------------------------ render

  const chat = (
    <SolChatView
      conversation={props.conversation}
      initialMessages={props.initialMessages}
      userName={props.userName}
      embedded={{
        emptyTitle: `What should ${summary.name} do?`,
        emptySuggestions: ["Add sign-up and a dashboard for users", "Make it look more premium", "Add a database of items people can add and edit", "Build a landing page with pricing"],
        registerSend: (send) => (sendRef.current = send),
        onToolFinished,
        transformOutgoing,
        returnTo: `/dashboard/apps/${appId}`,
        composerPrefix: (
          <>
            {turnChange && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, padding: "0.45rem 0.6rem", borderRadius: 10, background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.25)", fontSize: "0.76rem", color: C.text }}>
                <span style={{ flex: 1 }}>SOL updated your app.</span>
                <Button size="sm" onClick={() => setDiff({ versionId: turnChange.from, against: turnChange.to, title: "What SOL changed" })}>
                  <Eye size={13} /> Review changes
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    const from = turnChange.from;
                    setTurnChange(null);
                    try {
                      await appsApi.restore(appId, from);
                      flash("Undone — rebuilding the preview.");
                      setRefreshKey((k) => k + 1);
                      void runBuild("Undo");
                    } catch (err) {
                      flash(err instanceof ApiError ? err.message : "Couldn't undo.");
                    }
                  }}
                >
                  <Undo2 size={13} /> Undo
                </Button>
              </div>
            )}
            {selected && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, padding: "0.45rem 0.6rem", borderRadius: 10, background: "rgba(139,92,246,0.12)", border: "1px solid rgba(139,92,246,0.35)", fontSize: "0.76rem", color: C.text }}>
                <MousePointerClick size={14} color={C.brand} />
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  Editing <code style={{ fontFamily: C.mono }}>&lt;{selected.tag}&gt;</code>
                  {selected.text ? ` "${selected.text.slice(0, 40)}${selected.text.length > 40 ? "…" : ""}"` : ""} · {selected.file?.split("/").pop()}
                  {selected.line ? `:${selected.line}` : ""}
                </span>
                <button type="button" aria-label="Clear selected element" onClick={() => setSelected(null)} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer" }}>
                  <X size={14} />
                </button>
              </div>
            )}
          </>
        ),
      }}
    />
  );

  return (
    <div className="app-editor" style={{ height: "100dvh", display: "flex", flexDirection: "column", background: C.bg, color: C.text }}>
      {/* Top bar */}
      <header style={{ display: "flex", alignItems: "center", gap: 10, padding: "0.55rem 0.8rem", borderBottom: `1px solid ${C.border}`, minHeight: 52 }}>
        <Link href="/dashboard/apps" aria-label="Back to apps" style={{ color: C.muted, display: "inline-flex" }}>
          <ArrowLeft size={18} />
        </Link>
        <div style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
          <span style={{ fontWeight: 700, fontSize: "0.9rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{summary.name}</span>
          <span style={{ fontSize: "0.68rem", color: statusPill.color }}>● {statusPill.label}</span>
        </div>

        <div className="app-editor-desktop-only" style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 12, flex: 1, minWidth: 0 }}>
          <div style={{ display: "inline-flex", border: `1px solid ${C.border}`, borderRadius: 9, overflow: "hidden" }}>
            {([["desktop", Monitor, "Desktop (full width)"], ["tablet", Tablet, "Tablet (768px)"], ["mobile", Smartphone, "Phone (375px)"]] as const).map(([v, Icon, label]) => (
              <button key={v} type="button" aria-label={label} title={label} onClick={() => { setViewport(v); setTab("preview"); }} style={{ padding: "0.38rem 0.55rem", border: "none", cursor: "pointer", background: viewport === v ? "rgba(139,92,246,0.25)" : "transparent", color: viewport === v ? C.text : C.muted }}>
                <Icon size={15} />
              </button>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setRoute(routeDraft.startsWith("/") ? routeDraft : `/${routeDraft}`);
              setTab("preview");
            }}
            style={{ flex: 1, minWidth: 120, maxWidth: 420 }}
          >
            <input
              aria-label="Page address"
              value={routeDraft}
              onChange={(e) => setRouteDraft(e.target.value)}
              style={{ width: "100%", padding: "0.38rem 0.6rem", borderRadius: 9, border: `1px solid ${C.border}`, background: "rgba(255,255,255,0.04)", color: C.text, fontFamily: C.mono, fontSize: "0.76rem" }}
            />
          </form>
          <Button size="sm" variant={inspecting ? "primary" : "secondary"} onClick={() => { setInspecting((v) => !v); setTab("preview"); }} aria-pressed={inspecting} title="Select & Edit: click an element in your app, then tell SOL what to change">
            <MousePointerClick size={14} /> Select
          </Button>
          <Button size="sm" variant="ghost" aria-label="Reload preview" onClick={() => setReloadKey((k) => k + 1)}>
            <RotateCw size={14} />
          </Button>
          {summary.previewUrl && (
            <>
              <a href={`${summary.previewUrl}${route}`} target="_blank" rel="noopener" aria-label="Open preview in a new tab" style={{ color: C.muted, display: "inline-flex", padding: "0.3rem" }}>
                <ExternalLink size={15} />
              </a>
              <Button size="sm" variant="ghost" onClick={copyPreviewLink} title="Copy a shareable preview link">
                <Link2 size={14} /> {copied ? "Copied" : "Share"}
              </Button>
            </>
          )}
        </div>

        <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
          {summary.liveUrl && (
            <a href={summary.liveUrl} target="_blank" rel="noopener" className="app-editor-desktop-only" style={{ fontSize: "0.74rem", color: C.success, textDecoration: "none", marginRight: 4 }}>
              ● Live
            </a>
          )}
          <Button variant="primary" size="sm" onClick={() => setPublishOpen(true)}>
            <Rocket size={14} /> {summary.published ? "Publish changes" : "Publish"}
          </Button>
        </div>
      </header>

      {/* Mobile switcher */}
      <div className="app-editor-mobile-only" style={{ display: "none", padding: "0.4rem 0.6rem", gap: 6, borderBottom: `1px solid ${C.border}` }}>
        {(["chat", "app"] as const).map((v) => (
          <button key={v} type="button" onClick={() => setMobileView(v)} style={{ flex: 1, padding: "0.45rem", borderRadius: 9, border: `1px solid ${C.border}`, background: mobileView === v ? "rgba(139,92,246,0.25)" : "transparent", color: C.text, fontSize: "0.8rem", display: "inline-flex", gap: 6, justifyContent: "center", alignItems: "center" }}>
            {v === "chat" ? <MessageSquare size={14} /> : <AppWindow size={14} />} {v === "chat" ? "Chat" : "App"}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <aside className={`app-editor-chat ${mobileView === "chat" ? "is-active" : ""}`} style={{ width: 430, flexShrink: 0, borderRight: `1px solid ${C.border}`, minHeight: 0, display: "flex", flexDirection: "column" }}>
          {chat}
        </aside>

        <main className={`app-editor-main ${mobileView === "app" ? "is-active" : ""}`} style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <nav role="tablist" aria-label="App tools" style={{ display: "flex", gap: 2, padding: "0.35rem 0.6rem", borderBottom: `1px solid ${C.border}`, overflowX: "auto" }}>
            {TABS.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} style={{ padding: "0.4rem 0.7rem", borderRadius: 8, border: "none", cursor: "pointer", fontSize: "0.78rem", fontWeight: 600, whiteSpace: "nowrap", background: tab === t.id ? "rgba(255,255,255,0.08)" : "transparent", color: tab === t.id ? C.text : C.muted }}>
                {t.label}
              </button>
            ))}
          </nav>

          <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
            {/* The preview stays mounted while other tabs are open, so the app keeps its state. */}
            <div style={{ position: "absolute", inset: 0, display: tab === "preview" ? "flex" : "none", flexDirection: "column" }}>
              <div style={{ flex: 1, minHeight: 0 }}>
                <PreviewPane
                  previewUrl={summary.latestBuild ? summary.previewUrl : null}
                  route={route}
                  reloadKey={reloadKey}
                  viewport={viewport}
                  inspecting={inspecting}
                  building={building || !!build?.pending}
                  onNavigate={onNavigate}
                  onSelect={onSelect}
                  onError={onPreviewError}
                />
              </div>
              <ProblemsBar
                buildErrors={buildErrors}
                migrationFailure={build && !build.pending ? build.migrations?.failed ?? null : null}
                typeProblems={build && !build.pending ? build.typeProblems : []}
                runtimeErrors={runtimeErrors}
                onFix={fixWithAi}
                onFixAll={() =>
                  sendToSol(
                    `Fix these problems in my app, then rebuild and check it works:\n\n${[
                      ...buildErrors.map((e) => `${e.file ?? ""}${e.line ? `:${e.line}` : ""} ${e.message}`),
                      ...(build?.typeProblems ?? []).map((e) => `${e.file ?? ""}${e.line ? `:${e.line}` : ""} ${e.message}`),
                      ...runtimeErrors.map((e) => `${e.message} (on ${e.url})`),
                    ].slice(0, 25).join("\n")}`,
                  )
                }
                onOpenFile={(file, line) => {
                  setCodeOpen({ path: file, line, nonce: Date.now() });
                  setTab("code");
                }}
                onDismissRuntime={() => setRuntimeErrors([])}
              />
            </div>
            {tab === "code" && <CodePane appId={appId} openRequest={codeOpen} refreshKey={refreshKey} onSaved={onCodeSaved} />}
            {tab === "database" && (
              <Scroll>
                <DatabasePane appId={appId} refreshKey={refreshKey} onAskAi={sendToSol} />
              </Scroll>
            )}
            {tab === "users" && (
              <Scroll>
                <UsersPane appId={appId} />
              </Scroll>
            )}
            {tab === "functions" && (
              <Scroll>
                <FunctionsPane appId={appId} refreshKey={refreshKey} />
              </Scroll>
            )}
            {tab === "secrets" && (
              <Scroll>
                <SecretsPane appId={appId} addName={props.addSecretName ?? undefined} />
              </Scroll>
            )}
            {tab === "history" && (
              <Scroll>
                <HistoryPane
                  appId={appId}
                  refreshKey={refreshKey}
                  onRestored={() => {
                    setRefreshKey((k) => k + 1);
                    void runBuild("Restored a version");
                  }}
                  onViewChanges={(versionId, against) => setDiff({ versionId, against, title: "Changes in this version" })}
                />
              </Scroll>
            )}
            {tab === "github" && (
              <Scroll>
                <GitHubPane
                  appId={appId}
                  onLinked={() => {
                    setRefreshKey((k) => k + 1);
                    void refreshSummary();
                    void runBuild("Linked to GitHub");
                  }}
                />
              </Scroll>
            )}
            {tab === "settings" && (
              <Scroll>
                <SettingsPane appId={appId} summary={summary} onRenamed={(name) => setSummary((s) => ({ ...s, name }))} />
              </Scroll>
            )}
          </div>
        </main>
      </div>

      {diff && (
        <div role="dialog" aria-modal="true" aria-label={diff.title} style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,0.6)", display: "flex", padding: "3vh 3vw" }} onClick={(e) => e.target === e.currentTarget && setDiff(null)}>
          <div style={{ flex: 1, background: C.panelSolid, borderRadius: 14, border: `1px solid ${C.borderStrong}`, overflow: "hidden", display: "flex" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <DiffView appId={appId} versionId={diff.versionId} against={diff.against} title={diff.title} onClose={() => setDiff(null)} />
            </div>
          </div>
        </div>
      )}

      {publishOpen && (
        <PublishDialog
          appId={appId}
          summary={summary}
          onClose={() => setPublishOpen(false)}
          onPublished={() => {
            void refreshSummary();
            setRefreshKey((k) => k + 1);
          }}
        />
      )}

      {toast && (
        <div role="status" style={{ position: "fixed", bottom: 18, left: "50%", transform: "translateX(-50%)", zIndex: 70, padding: "0.55rem 0.9rem", borderRadius: 10, background: C.panelSolid, border: `1px solid ${C.borderStrong}`, fontSize: "0.8rem" }}>
          {toast}
        </div>
      )}

      <style>{`
        @media (max-width: 900px) {
          .app-editor-desktop-only { display: none !important; }
          .app-editor-mobile-only { display: flex !important; }
          .app-editor-chat, .app-editor-main { display: none !important; }
          .app-editor-chat.is-active, .app-editor-main.is-active { display: flex !important; width: 100% !important; border-right: none !important; }
        }
      `}</style>
    </div>
  );
}

function Scroll({ children }: { children: React.ReactNode }) {
  return <div style={{ position: "absolute", inset: 0, overflow: "auto", padding: "1rem" }}>{children}</div>;
}

function ProblemsBar(props: {
  buildErrors: BuildError[];
  typeProblems: BuildError[];
  migrationFailure: { name: string; message: string; line?: number; hint?: string } | null;
  runtimeErrors: PreviewError[];
  onFix: (error: { message: string; stack?: string | null; url?: string | null; file?: string; line?: number }) => void;
  onFixAll: () => void;
  onOpenFile: (file: string, line?: number) => void;
  onDismissRuntime: () => void;
}) {
  const [open, setOpen] = useState(false);
  const count = props.buildErrors.length + props.runtimeErrors.length + (props.migrationFailure ? 1 : 0);
  const typeCount = props.typeProblems.length;
  if (!count && !typeCount) return null;
  const tone = count ? C.danger : C.warning;
  return (
    <div style={{ borderTop: `1px solid ${tone}55`, background: `${tone}12`, maxHeight: open ? "45%" : undefined, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0.45rem 0.8rem", fontSize: "0.78rem" }}>
        <Wrench size={14} color={tone} />
        <button type="button" onClick={() => setOpen((v) => !v)} style={{ background: "none", border: "none", color: C.text, cursor: "pointer", fontSize: "0.78rem", textAlign: "left", flex: 1 }}>
          {count ? `${count} problem${count > 1 ? "s" : ""} in your app` : `${typeCount} type issue${typeCount > 1 ? "s" : ""} (the app still runs)`} · {open ? "Hide" : "Show"}
        </button>
        <Button size="sm" variant="primary" onClick={props.onFixAll}>
          Fix with AI
        </Button>
      </div>
      {open && (
        <div style={{ overflow: "auto", padding: "0 0.8rem 0.6rem", display: "flex", flexDirection: "column", gap: 6 }}>
          {props.migrationFailure && (
            <ProblemRow title={`Database change ${props.migrationFailure.name} failed${props.migrationFailure.line ? ` (line ${props.migrationFailure.line})` : ""}`} detail={props.migrationFailure.message} onFix={() => props.onFix({ message: `Migration ${props.migrationFailure!.name} failed: ${props.migrationFailure!.message}`, file: `db/migrations/${props.migrationFailure!.name}`, line: props.migrationFailure!.line })} onOpen={() => props.onOpenFile(`db/migrations/${props.migrationFailure!.name}`, props.migrationFailure!.line)} />
          )}
          {[...props.buildErrors, ...props.typeProblems].map((e, i) => (
            <ProblemRow key={`b${i}`} title={`${e.file ?? e.kind}${e.line ? `:${e.line}` : ""}`} detail={e.message} snippet={e.snippet} onFix={() => props.onFix({ message: e.message, file: e.file, line: e.line })} onOpen={e.file ? () => props.onOpenFile(e.file!, e.line) : undefined} />
          ))}
          {props.runtimeErrors.map((e, i) => (
            <ProblemRow key={`r${i}`} title={`While running ${e.url}`} detail={e.message} snippet={e.stack?.split("\n").slice(0, 3).join("\n")} onFix={() => props.onFix(e)} />
          ))}
          {props.runtimeErrors.length > 0 && (
            <button type="button" onClick={props.onDismissRuntime} style={{ alignSelf: "flex-start", background: "none", border: "none", color: C.muted, fontSize: "0.74rem", cursor: "pointer" }}>
              Clear runtime errors
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ProblemRow(props: { title: string; detail: string; snippet?: string; onFix: () => void; onOpen?: () => void }) {
  return (
    <div style={{ padding: "0.5rem 0.65rem", borderRadius: 9, background: "rgba(0,0,0,0.25)", border: `1px solid ${C.border}`, display: "flex", gap: 8, alignItems: "flex-start" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: C.mono, fontSize: "0.72rem", color: C.muted }}>{props.title}</div>
        <div style={{ fontSize: "0.78rem", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{props.detail}</div>
        {props.snippet && <pre style={{ margin: "4px 0 0", fontFamily: C.mono, fontSize: "0.7rem", color: C.faint, whiteSpace: "pre-wrap" }}>{props.snippet}</pre>}
      </div>
      {props.onOpen && (
        <Button size="sm" variant="ghost" onClick={props.onOpen} aria-label="Open in Code">
          <Code2 size={13} />
        </Button>
      )}
      <Button size="sm" onClick={props.onFix}>
        Fix
      </Button>
    </div>
  );
}

