"use client";

import { trackEvent } from "@/lib/analytics";
import { SitePlanNotice } from "../../_components/SitePlanNotice";
import { SolGlyph } from "@/app/dashboard/_v3/sol/SolGlyph";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useAppBackHref, useEditorV3 } from "../../_components/EditorTheme";
import { ArrowLeft, ArrowUpRight, Check, ChevronDown, Code2, ExternalLink, AppWindow, MousePointerClick, RotateCw, Undo2, Eye, Wrench, X } from "lucide-react";
import { SolChatView } from "../../sol/_components/SolChatView";
import type { ConversationSummary, ModelTier, SolMessage } from "../../sol/_components/types";
import { appsApi, pollBuild, ApiError, type AppSummary, type BuildReport, type BuildError } from "./api";
import { C, Button } from "./ui";
import { advancedHref } from "@/lib/dashboardV3/hubAdvanced";
import { HUB_SECTION_FOR_PANEL } from "@/lib/dashboardV3/appEditorLinks";
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
import { DesignPane } from "./DesignPane";
import { ChatDock, ChatDot, useChatDrawer } from "./ChatDock";
import { CreditsMeter, CreditsPanel, OutOfCreditsCard, TopUpSheet, useCredits, type Pack } from "./Credits";
import { takeHandoff, describeExtras, type StartHandoff } from "./startHandoff";
import { AppPreview, buildSteps, decodePlan, brandGradient, gradientFor } from "./appPlan";

// The app editor (wireframes E, F, F2): chat with SOL on the left; the app on the right with
// everyday tabs (Preview · Design · Data · People · Settings · More) and a separate Code
// switch for people who want to edit by hand. While SOL builds a new app's first version the
// right side shows the sketch from the questions and a plain-words checklist ticks off.

type Tab = "preview" | "design" | "database" | "users" | "settings" | "history" | "github" | "functions" | "secrets";

/** The spec's tab names for the app editor. */
const EDITOR_TAB_NAME: Record<Tab, string> = {
  preview: "preview",
  design: "design",
  database: "data",
  users: "people",
  settings: "settings",
  history: "history",
  github: "github",
  functions: "server_code",
  secrets: "secret_keys",
};
const MAIN_TABS: Array<{ id: Tab; label: string }> = [
  { id: "preview", label: "Preview" },
  { id: "design", label: "Design" },
  { id: "database", label: "Data" },
  { id: "users", label: "People" },
  { id: "settings", label: "Settings" },
];
const MORE_TABS: Array<{ id: Tab; label: string; hint: string }> = [
  { id: "history", label: "History", hint: "Every version, and going back" },
  { id: "github", label: "GitHub", hint: "Keep a copy in your GitHub" },
  { id: "functions", label: "Server code", hint: "Code that runs on the server" },
  { id: "secrets", label: "Secret keys", hint: "Passwords and API keys" },
];
const TAB_ALIASES: Record<string, Tab> = { data: "database", people: "users" };
const VIEWPORTS: Array<{ id: Viewport; label: string }> = [
  { id: "desktop", label: "Computer" },
  { id: "tablet", label: "Tablet" },
  { id: "mobile", label: "Phone" },
];
const SUGGESTIONS = ["Change the colours", "Add a new page", "Make it look great on phones"];

// Tools whose completion means the preview (and the files/data panes) changed.
const REFRESHING_TOOLS = new Set(["app_build", "app_build_status", "app_restore_version", "app_publish", "app_sql", "app_update_auth_settings"]);
const WRITING_TOOLS = new Set(["app_write_files", "app_edit_file", "app_delete_files", "app_rename_file", "app_design_edit"]);

const seg = (active: boolean) => ({
  padding: "0.42rem 0.8rem", borderRadius: 9, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: "0.82rem", whiteSpace: "nowrap" as const,
  background: active ? "var(--ed-w-120)" : "transparent", color: active ? C.text : C.muted, fontWeight: active ? 700 : 500,
});

export function AppEditor(props: {
  appId: string;
  /** Full view on the new dashboard: Data, People, Settings and More link to the app's own page instead of repeating them here. */
  hubLinks?: boolean;
  initialSummary: AppSummary;
  conversation: ConversationSummary;
  initialMessages: SolMessage[];
  userName: string | null;
  initialPrompt: string | null;
  initialPlan: string | null;
  initialPanel: string | null;
  addSecretName: string | null;
  stockKeys: { unsplash?: string; pexels?: string; pixabay?: string };
  lockedModelTier?: { tier: "BASIC"; note: string } | null;
  fontClassName?: string;
}) {
  const { appId } = props;
  const v3 = useEditorV3();
  const backHref = useAppBackHref(appId);
  const [summary, setSummary] = useState<AppSummary>(props.initialSummary);
  const initialTab = (TAB_ALIASES[props.initialPanel ?? ""] ?? [...MAIN_TABS, ...MORE_TABS].find((t) => t.id === props.initialPanel)?.id ?? "preview") as Tab;
  const [tab, setTab] = useState<Tab>(initialTab);
  const [codeMode, setCodeMode] = useState(props.initialPanel === "code");
  const [moreOpen, setMoreOpen] = useState(false);
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
  // The design editor's "Publish now" waits here until the publish window says the app is live (or is closed without publishing).
  const publishWaiter = useRef<{ resolve: () => void; reject: (e: Error) => void } | null>(null);
  const publishFromDesign = useCallback(
    () => new Promise<void>((resolve, reject) => {
      publishWaiter.current = { resolve, reject };
      setPublishOpen(true);
    }),
    [],
  );
  const [diff, setDiff] = useState<{ versionId: string; against: string; title: string } | null>(null);
  const [codeOpen, setCodeOpen] = useState<{ path: string; line?: number; nonce: number } | null>(null);
  const [turnChange, setTurnChange] = useState<{ from: string; to: string } | null>(null);
  const [mobileView, setMobileView] = useState<"chat" | "app">("app");
  const [copied, setCopied] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [codePreviewHidden, setCodePreviewHidden] = useState(false);
  // Full screen for the design canvas: hides the chat and this top bar so the page gets the room. Remembered per browser.
  const [designFocus, setDesignFocus] = useState(false);
  useEffect(() => {
    try {
      // Full screen unless the person turned it off: the design canvas needs the room more than the chat does.
      setDesignFocus(localStorage.getItem("plexo.design.focus") !== "0");
    } catch {}
  }, []);
  const toggleDesignFocus = useCallback(() => {
    setDesignFocus((v) => {
      try {
        localStorage.setItem("plexo.design.focus", v ? "0" : "1");
      } catch {}
      return !v;
    });
  }, []);
  const [turnRunning, setTurnRunning] = useState(false);
  const [hasChatted, setHasChatted] = useState(props.initialMessages.length > 0);

  // Credits
  const { credits, monthly, setCredits, refresh: refreshCredits } = useCredits();
  const [creditsOpen, setCreditsOpen] = useState(false);
  const [topUp, setTopUp] = useState<Pack | null>(null);
  const [outOfCredits, setOutOfCredits] = useState<{ resend: () => void; midTurn: boolean } | null>(null);

  // First build of a new app: the sketch + checklist (wireframe E).
  // The brief + files the owner gave on the Apps home arrive through the browser (startHandoff),
  // not the address bar; ?prompt= is still honoured for older links.
  const [handoff, setHandoff] = useState<StartHandoff | null>(null);
  const handoffTaken = useRef(false);
  const handoffRef = useRef<StartHandoff | null>(null);
  const extrasRef = useRef("");
  const plan = useMemo(() => decodePlan(handoff?.plan ?? props.initialPlan), [handoff, props.initialPlan]);
  const steps = useMemo(() => buildSteps(plan), [plan]);
  const [firstBuild, setFirstBuild] = useState(!!props.initialPrompt && props.initialMessages.length === 0);
  const [writes, setWrites] = useState(0);
  const [checked, setChecked] = useState(false);
  // Design and Code need the room: the chat becomes a drawer there (and stays docked everywhere else).
  const chatOverlay = !firstBuild && (codeMode || tab === "design");
  const drawer = useChatDrawer(chatOverlay);
  const stepsDone = firstBuild ? (checked ? steps.length - 1 : Math.min(steps.length - 1, writes)) : steps.length;

  // "Since you were last here"
  const [since, setSince] = useState<{ visits: number; problems: number; signups: number | null } | null>(null);

  const sendRef = useRef<((text: string, attachments?: Array<{ type: "image" | "pdf" | "document"; url: string; filename?: string }>, modelTier?: ModelTier) => void) | null>(null);
  const turnBaseVersion = useRef<string | null>(summary.headVersionId);
  const buildAbort = useRef<AbortController | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedRef = useRef<SelectedElement | null>(null);
  selectedRef.current = selected;
  const moreRef = useRef<HTMLDivElement>(null);

  const [designVisited, setDesignVisited] = useState(tab === "design");
  useEffect(() => {
    if (tab === "design") setDesignVisited(true);
  }, [tab]);

  const openTab = (t: Tab) => {
    trackEvent({ event: "editor_tab_view", tab_name: EDITOR_TAB_NAME[t], project_type: "app", project_id: appId });
    setTab(t);
    setCodeMode(false);
    setMoreOpen(false);
  };

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

  // Hand edits (Code, Design) → rebuild shortly after the typing stops.
  const onCodeSaved = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void runBuild("Edited in Code Mode"), 1200);
  }, [runBuild]);
  const onDesignSaved = useCallback(
    (message: string) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void runBuild(message), 1200);
    },
    [runBuild],
  );

  useEffect(() => {
    // A new app with a brief is built by SOL — don't also build the empty starter beside it.
    if (!handoffTaken.current) {
      handoffTaken.current = true;
      if (props.initialMessages.length === 0) {
        handoffRef.current = takeHandoff(appId) ?? (props.initialPrompt ? { prompt: props.initialPrompt, plan: props.initialPlan, notes: "", files: [] } : null);
      }
    }
    if (handoffRef.current) {
      setHandoff(handoffRef.current);
      setFirstBuild(true);
    } else if (!summary.latestBuild && !building) {
      void runBuild("First build");
    }
    return () => buildAbort.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------------ since you were last here

  useEffect(() => {
    const key = `plexo:app-seen:${appId}`;
    let last: string | null = null;
    try {
      last = localStorage.getItem(key);
      localStorage.setItem(key, new Date().toISOString());
    } catch {
      // private mode — skip the summary
    }
    if (!last) return;
    let cancelled = false;
    void fetch(`/api/v1/apps/${appId}/activity?since=${encodeURIComponent(last)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        setSince({ visits: d.visits ?? 0, problems: d.problems ?? 0, signups: null });
        return fetch(`/api/v1/apps/${appId}/activity?since=${encodeURIComponent(last!)}&part=signups`)
          .then((r) => (r.ok ? r.json() : null))
          .then((s) => !cancelled && s && typeof s.signups === "number" && setSince((p) => (p ? { ...p, signups: s.signups } : p)));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [appId]);

  // ------------------------------------------------------------------ SOL integration

  const onToolFinished = useCallback(
    (call: { name: string; status: string; result: unknown }) => {
      if (WRITING_TOOLS.has(call.name)) setWrites((w) => w + 1);
      if (call.name === "app_screenshot") setChecked(true);
      // SOL changed a designed page: the Design tab picks the new version up (unless the owner has unsaved edits open).
      if (call.name === "app_design_edit") setRefreshKey((k) => k + 1);
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
        if (!firstBuild && next?.headVersionId && turnBaseVersion.current && next.headVersionId !== turnBaseVersion.current) {
          setTurnChange({ from: turnBaseVersion.current, to: next.headVersionId });
        }
      });
    },
    [appId, refreshSummary, firstBuild],
  );

  const onTurnEnd = useCallback(
    (outcome: string) => {
      setTurnRunning(false);
      drawer.noteArrival();
      void refreshCredits();
      if (firstBuild && outcome !== "credit_exhausted" && outcome !== "awaiting_confirmation") {
        setFirstBuild(false);
        setReloadKey((k) => k + 1);
        void refreshSummary();
      }
    },
    [firstBuild, refreshCredits, refreshSummary, drawer.noteArrival],
  );

  const transformOutgoing = useCallback(
    (typed: string) => {
      // The owner's logo / notes / file roles ride along with the first message only.
      const text = extrasRef.current ? `${typed}\n\n${extrasRef.current}` : typed;
      extrasRef.current = "";
      setTurnRunning(true);
      // Sent from Design or Code (e.g. "Ask SOL"): show the chat so the answer isn't missed.
      drawer.openDrawer();
      setHasChatted(true);
      setOutOfCredits(null);
      turnBaseVersion.current = summary.headVersionId;
      setTurnChange(null);
      const el = selectedRef.current;
      if (!el) return text;
      setTimeout(() => setSelected(null), 0);
      const where = el.file ? `${el.file}${el.line ? `:${el.line}` : ""}` : "unknown file";
      return `${text}\n\n[Selected element: <${el.tag}> in ${where} on page ${el.path}${el.text ? ` — its text: "${el.text.slice(0, 160)}"` : ""}${el.classes ? ` — classes: "${el.classes.slice(0, 200)}"` : ""}. Change this element.]`;
    },
    [summary.headVersionId, drawer.openDrawer],
  );

  const sendToSol = useCallback((text: string) => {
    setMobileView("chat");
    drawer.openDrawer();
    sendRef.current?.(text);
  }, [drawer.openDrawer]);

  const fixWithAi = useCallback(
    (error: { message: string; stack?: string | null; url?: string | null; file?: string; line?: number }) => {
      const where = error.file ? `\nFile: ${error.file}${error.line ? `:${error.line}` : ""}` : "";
      sendToSol(`My app shows this error. Find the cause, fix it, rebuild and check it works:\n\n${error.message}${where}${error.stack ? `\n\n${error.stack.slice(0, 1500)}` : ""}${error.url ? `\n\nPage: ${error.url}` : ""}`);
    },
    [sendToSol],
  );

  // Opened from the Apps home with the first request already written.
  const sentInitial = useRef(false);
  useEffect(() => {
    if (!handoff || sentInitial.current || props.initialMessages.length) return;
    const timer = setInterval(() => {
      if (sendRef.current) {
        clearInterval(timer);
        sentInitial.current = true;
        extrasRef.current = describeExtras(handoff);
        sendRef.current(handoff.prompt, handoff.files.map((f) => ({ type: f.type, url: f.url, filename: f.name })), handoff.modelTier);
        window.history.replaceState(null, "", `/dashboard/apps/${appId}`);
      }
    }, 100);
    return () => clearInterval(timer);
  }, [handoff, props.initialMessages.length, appId]);

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

  useEffect(() => {
    if (!moreOpen) return;
    const onDown = (e: MouseEvent) => !moreRef.current?.contains(e.target as Node) && setMoreOpen(false);
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [moreOpen]);

  const copyPreviewLink = async () => {
    if (!summary.previewUrl) return;
    await navigator.clipboard.writeText(summary.previewUrl).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const buildErrors: BuildError[] = build && !build.pending && build.status === "FAILED" ? build.errors : [];
  const typeProblems = build && !build.pending ? build.typeProblems : [];
  const liveAt = summary.domains.find((d) => d.type === "CUSTOM" && d.verified)?.domain ?? (summary.liveUrl ? new URL(summary.liveUrl).host : null);
  const status = firstBuild
    ? { label: "Building… this usually takes a few minutes", color: C.brand }
    : building || build?.pending
      ? { label: "Updating your preview…", color: C.brand }
      : buildErrors.length || build?.migrations?.failed
        ? { label: "Something needs fixing", color: C.danger }
        : summary.published && liveAt
          ? { label: `● Live at ${liveAt}`, color: C.success }
          : { label: "Draft — not published yet", color: C.muted };

  const firstProblem = buildErrors[0] ?? typeProblems[0] ?? null;
  const firstRuntime = !firstProblem ? runtimeErrors[0] ?? null : null;

  // ------------------------------------------------------------------ chat

  const showSuggestions = hasChatted && !firstBuild && !turnRunning && !outOfCredits && !selected && !turnChange;
  const chat = (
    <SolChatView
      conversation={props.conversation}
      initialMessages={props.initialMessages}
      userName={props.userName}
      embedded={{
        emptyTitle: `What should ${summary.name} do?`,
        emptySuggestions: ["Add sign-up and a dashboard for users", "Make it look more premium", "Add a list of items people can add and edit", "Build a landing page with pricing"],
        registerSend: (send) =>
          (sendRef.current = (text, ...rest) => {
            // Every prompt sent from the app editor's chat, typed or suggested. The prompt text is never sent.
            trackEvent({ event: "sol_prompt_submit", sol_context: "app_editor", project_type: "app" });
            return send(text, ...rest);
          }),
        onToolFinished,
        onTurnEnd,
        transformOutgoing,
        returnTo: `/dashboard/apps/${appId}`,
        composerPlaceholder: firstBuild ? "Add something while I build…" : "What would you like to change?",
        onCreditExhausted: (_info, resend, midTurn) => {
          setTurnRunning(false);
          void refreshCredits();
          setOutOfCredits({ resend, midTurn });
        },
        // Free plans on Plexo's AI run on Basic (the server enforces it — lib/ai/solEngine.ts).
        lockedModelTier: props.lockedModelTier ?? undefined,
        afterMessages: firstBuild ? (
          <div style={{ width: "100%", boxSizing: "border-box", maxWidth: 760, margin: "0.5rem auto 1rem", border: "1px solid color-mix(in srgb, var(--brand) 28%, transparent)", background: "linear-gradient(180deg, color-mix(in srgb, var(--brand) 10%, transparent), color-mix(in srgb, var(--brand) 3%, transparent))", borderRadius: 14, padding: "0.9rem 1rem", display: "flex", flexDirection: "column", gap: "0.7rem" }}>
            <div style={{ fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: C.faint }}>What I&rsquo;m doing</div>
            {steps.map((label, i) => {
              const state = i < stepsDone ? "done" : i === stepsDone ? "active" : "todo";
              return (
                <div key={label} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: "0.86rem", fontWeight: state === "active" ? 700 : 500, color: state === "todo" ? C.faint : C.text }}>
                  <span style={{ width: 20, height: 20, borderRadius: 99, flexShrink: 0, display: "grid", placeItems: "center", background: state === "done" ? C.success : "transparent", border: state === "done" ? "none" : `${state === "active" ? 2 : 1.5}px solid ${state === "active" ? C.brand : C.borderStrong}`, color: "var(--ed-on-brand)" }}>
                    {state === "done" && <Check size={12} strokeWidth={3} />}
                    {state === "active" && <span className="ed-pulse" style={{ width: 8, height: 8, borderRadius: 99, background: C.brand }} />}
                  </span>
                  {label}
                </div>
              );
            })}
          </div>
        ) : undefined,
        composerPrefix: (
          <>
            {outOfCredits && (
              <OutOfCreditsCard
                midTurn={outOfCredits.midTurn}
                onPick={setTopUp}
                onDismiss={() => setOutOfCredits(null)}
                onOpenCode={() => {
                  setCodeMode(true);
                  setMobileView("app");
                }}
              />
            )}
            {turnChange && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, padding: "0.45rem 0.6rem", borderRadius: 10, background: "color-mix(in srgb, var(--ed-success) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--ed-success) 25%, transparent)", fontSize: "0.76rem", color: C.text }}>
                <span style={{ flex: 1 }}>SOL updated your app.</span>
                <Button size="sm" onClick={() => setDiff({ versionId: turnChange.from, against: turnChange.to, title: "What SOL changed" })}>
                  <Eye size={13} /> See what changed
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
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, padding: "0.45rem 0.6rem", borderRadius: 10, background: "color-mix(in srgb, var(--brand) 12%, transparent)", border: "1px solid color-mix(in srgb, var(--brand) 35%, transparent)", fontSize: "0.76rem", color: C.text }}>
                <MousePointerClick size={14} color={C.brand} />
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  Changing this {selected.tag === "img" ? "picture" : selected.tag === "button" || selected.tag === "a" ? "button" : "part"}
                  {selected.text ? `: "${selected.text.slice(0, 40)}${selected.text.length > 40 ? "…" : ""}"` : ""}
                </span>
                <button type="button" aria-label="Clear selected element" onClick={() => setSelected(null)} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer" }}>
                  <X size={14} />
                </button>
              </div>
            )}
            {showSuggestions && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" onClick={() => sendToSol(s)} style={{ padding: "0.32rem 0.7rem", borderRadius: 99, border: `1px solid ${C.border}`, background: "transparent", color: C.text, fontFamily: "inherit", fontSize: "0.76rem", cursor: "pointer" }}>
                    {s}
                  </button>
                ))}
              </div>
            )}
          </>
        ),
      }}
    />
  );

  // ------------------------------------------------------------------ right side

  const previewToolbar = (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0.9rem 1.1rem 0.75rem", flexWrap: "wrap" }}>
      <div role="group" aria-label="Screen size" style={{ display: "inline-flex", gap: 3, padding: 3, borderRadius: 10, background: "var(--ed-w-050)" }}>
        {VIEWPORTS.map((v) => (
          <button key={v.id} type="button" aria-pressed={viewport === v.id} onClick={() => setViewport(v.id)} style={{ ...seg(viewport === v.id), padding: "0.32rem 0.75rem", fontSize: "0.78rem" }}>
            {v.label}
          </button>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setRoute(routeDraft.startsWith("/") ? routeDraft : `/${routeDraft}`);
        }}
        style={{ flex: 1, minWidth: 140, maxWidth: 360 }}
      >
        <input aria-label="Page address" value={routeDraft} onChange={(e) => setRouteDraft(e.target.value)} style={{ width: "100%", padding: "0.4rem 0.7rem", borderRadius: 10, border: `1px solid ${C.border}`, background: "var(--ed-w-030)", color: C.text, fontFamily: C.mono, fontSize: "0.76rem" }} />
      </form>
      <button
        type="button"
        aria-pressed={inspecting}
        onClick={() => setInspecting((v) => !v)}
        style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "0.42rem 0.8rem", borderRadius: 10, cursor: "pointer", fontFamily: "inherit", fontSize: "0.78rem", fontWeight: 600, border: `1px solid ${inspecting ? C.text : C.border}`, background: inspecting ? C.text : "transparent", color: inspecting ? C.bg : C.text }}
      >
        <MousePointerClick size={14} /> {inspecting ? "Click the part to change" : "Point at something to change it"}
      </button>
      <span style={{ marginLeft: "auto", display: "inline-flex", gap: 2 }}>
        <Button size="sm" variant="ghost" aria-label="Reload preview" onClick={() => setReloadKey((k) => k + 1)}>
          <RotateCw size={14} />
        </Button>
        {summary.previewUrl && (
          <a href={`${summary.previewUrl}${route}`} target="_blank" rel="noopener" aria-label="Open in a new tab" style={{ color: C.muted, display: "inline-flex", padding: "0.35rem" }}>
            <ExternalLink size={15} />
          </a>
        )}
      </span>
    </div>
  );

  const previewPane = (vp: Viewport) => (
    <PreviewPane
      previewUrl={summary.latestBuild ? summary.previewUrl : null}
      route={route}
      reloadKey={reloadKey}
      viewport={vp}
      inspecting={inspecting}
      building={building || !!build?.pending}
      onNavigate={onNavigate}
      onSelect={onSelect}
      onError={onPreviewError}
    />
  );

  const buildingView = (
    <div style={{ position: "absolute", inset: 0, padding: "1.1rem", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {plan ? (
          <AppPreview audience={plan.audience} features={plan.features} other={plan.other} name={plan.name} />
        ) : (
          <div style={{ flex: 1, borderRadius: 16, border: `1px solid ${C.border}`, display: "grid", placeItems: "center", color: C.muted, fontSize: "0.86rem", background: "radial-gradient(60% 50% at 30% 20%, color-mix(in srgb, var(--ed-violet) 12%, transparent), transparent 70%), radial-gradient(60% 60% at 75% 80%, color-mix(in srgb, var(--brand) 18%, transparent), transparent 70%)" }}>
            Your app appears here as it&rsquo;s built.
          </div>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ flex: 1, height: 6, borderRadius: 99, background: "var(--ed-w-100)" }}>
          <span style={{ display: "block", width: `${Math.max(6, (stepsDone / steps.length) * 100)}%`, height: "100%", borderRadius: 99, background: brandGradient, transition: "width 0.6s" }} />
        </span>
        <span style={{ fontSize: "0.78rem", color: C.muted, whiteSpace: "nowrap" }}>
          {stepsDone} of {steps.length} done
        </span>
      </div>
    </div>
  );

  const codeView = (
    <div style={{ position: "absolute", inset: 0, display: "flex" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <CodePane appId={appId} openRequest={codeOpen} refreshKey={refreshKey} onSaved={onCodeSaved} previewUpdating={building || !!build?.pending} />
      </div>
      {codePreviewHidden ? (
        <button type="button" onClick={() => setCodePreviewHidden(false)} aria-label="Show live preview" style={{ writingMode: "vertical-rl", padding: "0.8rem 0.35rem", border: "none", borderLeft: `1px solid ${C.border}`, background: "transparent", color: C.muted, cursor: "pointer", fontFamily: "inherit", fontSize: "0.74rem", fontWeight: 600 }}>
          Show live preview
        </button>
      ) : (
        <div className="ed-code-preview" style={{ width: 340, flexShrink: 0, borderLeft: `1px solid ${C.border}`, padding: 14, display: "flex", flexDirection: "column", gap: 10, minHeight: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: C.faint }}>Live preview</span>
            <button type="button" onClick={() => setCodePreviewHidden(true)} style={{ background: "none", border: "none", color: C.text, fontFamily: "inherit", fontSize: "0.76rem", fontWeight: 600, cursor: "pointer" }}>
              Hide
            </button>
          </div>
          <div style={{ flex: 1, minHeight: 0, borderRadius: 12, border: `1px solid ${C.border}`, overflow: "hidden" }}>{previewPane("mobile")}</div>
          {(firstProblem || firstRuntime) && (
            <div style={{ borderRadius: 12, border: `1px solid ${C.border}`, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: "0.82rem", fontWeight: 700 }}>
                {firstProblem ? `${buildErrors.length + typeProblems.length === 1 ? "1 problem" : `${buildErrors.length + typeProblems.length} problems`}${firstProblem.file ? ` in ${firstProblem.file.split("/").pop()}` : ""}` : "Your app hit an error"}
              </div>
              <div style={{ fontSize: "0.78rem", color: C.muted, lineHeight: 1.45, wordBreak: "break-word" }}>
                {firstProblem ? `${firstProblem.line ? `Line ${firstProblem.line}: ` : ""}${firstProblem.message}` : firstRuntime!.message}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <Button size="sm" variant="primary" onClick={() => (firstProblem ? fixWithAi({ message: firstProblem.message, file: firstProblem.file, line: firstProblem.line }) : fixWithAi(firstRuntime!))}>
                  Fix it for me
                </Button>
                {firstProblem?.file && (
                  <Button size="sm" onClick={() => setCodeOpen({ path: firstProblem.file!, line: firstProblem.line, nonce: Date.now() })}>
                    Go to line
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );

  const focusing = designFocus && tab === "design" && !codeMode;
  const moreActive = MORE_TABS.find((t) => t.id === tab && !codeMode);
  const publishable = !firstBuild && !!summary.latestBuild;

  // ------------------------------------------------------------------ render

  return (
    <div className={`app-editor ${props.fontClassName ?? ""}`} style={{ height: "100dvh", display: "flex", flexDirection: "column", background: C.bg, color: C.text }}>
      {/* Top bar */}
      {!focusing && <header className="ed-top" style={{ display: "flex", alignItems: "center", gap: 14, padding: "0 1.1rem", borderBottom: `1px solid ${C.border}`, minHeight: 60 }}>
        <Link href={backHref} aria-label={v3 ? "Back to your app" : "Back to apps"} style={{ color: C.muted, display: "inline-flex" }}>
          <ArrowLeft size={18} />
        </Link>
        <span aria-hidden style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, display: "grid", placeItems: "center", background: gradientFor(summary.name), color: "var(--ed-on-brand)", fontWeight: 800, fontSize: "0.86rem" }}>
          {summary.name.charAt(0).toUpperCase()}
        </span>
        <div style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
          <span style={{ fontWeight: 700, fontSize: "0.94rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 220 }}>{summary.name}</span>
          <span style={{ fontSize: "0.74rem", color: status.color, whiteSpace: "nowrap" }}>{status.label}</span>
        </div>

        {!firstBuild && <nav className="ed-tabs" aria-label="App tools" style={{ marginLeft: 28, display: "flex", alignItems: "center", gap: 8 }}>
          <div role="tablist" style={{ display: "inline-flex", gap: 3, padding: 4, borderRadius: 12, background: "var(--ed-w-050)" }}>
            {MAIN_TABS.map((t) =>
              props.hubLinks && HUB_SECTION_FOR_PANEL[t.id] ? (
                <Link key={t.id} href={advancedHref(appId, HUB_SECTION_FOR_PANEL[t.id])} title={`Opens ${t.label} on your app's page`} style={{ ...seg(false), display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "none" }}>
                  {t.label} <ArrowUpRight size={12} aria-hidden />
                </Link>
              ) : (
                <button key={t.id} type="button" role="tab" aria-selected={!codeMode && tab === t.id} onClick={() => openTab(t.id)} style={seg(!codeMode && tab === t.id)}>
                  {t.label}
                </button>
              ),
            )}
            <div ref={moreRef} style={{ position: "relative" }}>
              <button type="button" aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => setMoreOpen((v) => !v)} style={{ ...seg(!!moreActive), display: "inline-flex", alignItems: "center", gap: 4 }}>
                {moreActive ? moreActive.label : "More"} <ChevronDown size={13} />
              </button>
              {moreOpen && (
                <div role="menu" style={{ position: "absolute", top: "calc(100% + 8px)", left: 0, zIndex: 80, width: 260, padding: 6, borderRadius: 12, background: C.panelSolid, border: `1px solid ${C.borderStrong}`, boxShadow: "0 24px 60px -20px rgba(0,0,0,0.7)" }}>
                  {MORE_TABS.map((t) =>
                    props.hubLinks && HUB_SECTION_FOR_PANEL[t.id] ? (
                      <Link key={t.id} href={advancedHref(appId, HUB_SECTION_FOR_PANEL[t.id])} role="menuitem" style={{ display: "block", textDecoration: "none", padding: "0.55rem 0.65rem", borderRadius: 9, color: C.text }}>
                      <span style={{ display: "block", fontSize: "0.84rem", fontWeight: 600 }}>{t.label}</span>
                      <span style={{ display: "block", fontSize: "0.74rem", color: C.muted }}>{t.hint}</span>
                      </Link>
                    ) : (
                      <button key={t.id} type="button" role="menuitem" onClick={() => openTab(t.id)} style={{ width: "100%", textAlign: "left", padding: "0.55rem 0.65rem", borderRadius: 9, border: "none", cursor: "pointer", fontFamily: "inherit", background: tab === t.id && !codeMode ? "var(--ed-w-080)" : "transparent", color: C.text }}>
                      <span style={{ display: "block", fontSize: "0.84rem", fontWeight: 600 }}>{t.label}</span>
                      <span style={{ display: "block", fontSize: "0.74rem", color: C.muted }}>{t.hint}</span>
                      </button>
                    ),
                  )}
                </div>
              )}
            </div>
          </div>
          <span aria-hidden style={{ width: 1, height: 26, background: C.border, margin: "0 4px" }} />
          <button
            type="button"
            aria-pressed={codeMode}
            onClick={() => {
              setCodeMode((v) => !v);
              setMoreOpen(false);
            }}
            title="Edit the code yourself — no credits used"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "0.45rem 0.8rem", borderRadius: 10, cursor: "pointer", fontFamily: C.mono, fontSize: "0.8rem", fontWeight: 600, border: codeMode ? "none" : `1px solid ${C.border}`, background: codeMode ? C.text : "transparent", color: codeMode ? C.bg : C.muted }}
          >
            <Code2 size={14} /> Code
          </button>
          {chatOverlay && (
            <button type="button" aria-expanded={drawer.open} onClick={drawer.toggleDrawer} title="Open the chat with SOL" style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "0.45rem 0.8rem", borderRadius: 10, cursor: "pointer", fontFamily: "inherit", fontSize: "0.8rem", fontWeight: 600, whiteSpace: "nowrap", border: `1px solid ${drawer.open ? C.text : C.border}`, background: "transparent", color: C.text }}>
              <SolGlyph size={14} /> Chat with SOL <ChatDot working={turnRunning} unread={drawer.unread} />
            </button>
          )}
        </nav>}

        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ position: "relative" }} className="ed-desktop">
            <CreditsMeter credits={credits} monthly={monthly} open={creditsOpen} onToggle={() => setCreditsOpen((v) => !v)} />
            {creditsOpen && (
              <CreditsPanel
                credits={credits}
                monthly={monthly}
                onClose={() => setCreditsOpen(false)}
                onPick={(p) => {
                  setCreditsOpen(false);
                  setTopUp(p);
                }}
              />
            )}
          </div>
          <button type="button" disabled={!publishable || !summary.previewUrl} onClick={copyPreviewLink} title="Copy a link anyone can open" style={{ padding: "0.5rem 0.85rem", borderRadius: 10, border: `1px solid ${C.border}`, background: "transparent", color: publishable ? C.text : C.faint, fontFamily: "inherit", fontSize: "0.8rem", cursor: publishable ? "pointer" : "default" }}>
            {copied ? "Link copied" : "Share"}
          </button>
          <button type="button" disabled={!publishable} onClick={() => setPublishOpen(true)} style={{ padding: "0.5rem 0.95rem", borderRadius: 10, border: "none", background: publishable ? brandGradient : "var(--ed-w-120)", color: publishable ? "var(--ed-on-brand)" : C.faint, boxShadow: publishable ? "0 6px 20px color-mix(in srgb, var(--brand) 35%, transparent)" : "none", fontFamily: "inherit", fontSize: "0.8rem", fontWeight: 700, cursor: publishable ? "pointer" : "default" }}>
            {summary.published ? "Publish changes" : "Publish"}
          </button>
        </div>
      </header>}
      {!focusing && <SitePlanNotice templateId={appId} refreshKey={summary.liveUrl ?? null} />}

      {/* Mobile switcher */}
      <div className="ed-mobile" style={{ display: "none", padding: "0.4rem 0.6rem", gap: 6, borderBottom: `1px solid ${C.border}` }}>
        {(["chat", "app"] as const).map((v) => (
          <button key={v} type="button" onClick={() => setMobileView(v)} style={{ flex: 1, padding: "0.45rem", borderRadius: 9, border: `1px solid ${C.border}`, background: mobileView === v ? "var(--ed-w-100)" : "transparent", color: C.text, fontSize: "0.8rem", display: "inline-flex", gap: 6, justifyContent: "center", alignItems: "center" }}>
            {v === "chat" ? <SolGlyph size={14} /> : <AppWindow size={14} />} {v === "chat" ? "Chat" : "App"}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "flex", position: "relative" }}>
        <ChatDock overlay={chatOverlay} open={drawer.open} mobileActive={mobileView === "chat"} onClose={drawer.closeDrawer}>
          {since && !firstBuild && (
            <div style={{ padding: "0.9rem 1.2rem", borderBottom: `1px solid ${C.border}`, display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: C.faint }}>Since you were last here</div>
              <div style={{ fontSize: "0.84rem", lineHeight: 1.5 }}>
                {since.visits.toLocaleString()} {since.visits === 1 ? "visit" : "visits"}
                {since.signups !== null && <> · {since.signups} {since.signups === 1 ? "person" : "people"} signed up</>}
                {" · "}
                {since.problems ? <span style={{ color: C.danger }}>{since.problems === 1 ? "1 problem" : `${since.problems} problems`}</span> : "nothing broken"}
              </div>
            </div>
          )}
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>{chat}</div>
        </ChatDock>

        <main className={`ed-main ${mobileView === "app" ? "is-active" : ""}`} style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
            {firstBuild ? (
              buildingView
            ) : codeMode ? (
              codeView
            ) : (
              <>
                {/* The preview stays mounted while other tabs are open, so the app keeps its state. */}
                <div style={{ position: "absolute", inset: 0, display: tab === "preview" ? "flex" : "none", flexDirection: "column" }}>
                  {previewToolbar}
                  <div style={{ flex: 1, minHeight: 0, margin: "0 1.1rem 1.1rem", borderRadius: 16, border: `1px solid ${C.border}`, overflow: "hidden", display: "flex", flexDirection: "column" }}>
                    <div style={{ flex: 1, minHeight: 0 }}>{previewPane(viewport)}</div>
                    <ProblemsBar
                      buildErrors={buildErrors}
                      migrationFailure={build && !build.pending ? build.migrations?.failed ?? null : null}
                      typeProblems={typeProblems}
                      runtimeErrors={runtimeErrors}
                      onFix={fixWithAi}
                      onFixAll={() =>
                        sendToSol(
                          `Fix these problems in my app, then rebuild and check it works:\n\n${[
                            ...buildErrors.map((e) => `${e.file ?? ""}${e.line ? `:${e.line}` : ""} ${e.message}`),
                            ...typeProblems.map((e) => `${e.file ?? ""}${e.line ? `:${e.line}` : ""} ${e.message}`),
                            ...runtimeErrors.map((e) => `${e.message} (on ${e.url})`),
                          ].slice(0, 25).join("\n")}`,
                        )
                      }
                      onOpenFile={(file, line) => {
                        setCodeOpen({ path: file, line, nonce: Date.now() });
                        setCodeMode(true);
                      }}
                      onDismissRuntime={() => setRuntimeErrors([])}
                    />
                  </div>
                </div>
                {designVisited && (
                  <div style={{ position: "absolute", inset: 0, display: tab === "design" ? "block" : "none" }}>
                    <DesignPane
                      appId={appId}
                      refreshKey={refreshKey}
                      stockKeys={props.stockKeys}
                      onSaved={onDesignSaved}
                      fullScreen={designFocus}
                      onToggleFullScreen={toggleDesignFocus}
                      onAskSol={sendToSol}
                      onPublish={publishable ? publishFromDesign : undefined}
                      hasAddress={Boolean(summary.published)}
                      onOpenCode={(path) => {
                        setCodeOpen({ path, nonce: Date.now() });
                        setCodeMode(true);
                      }}
                      onPreview={(path) => {
                        setRoute(path);
                        setRouteDraft(path);
                        openTab("preview");
                      }}
                    />
                  </div>
                )}
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
                    <FunctionsPane appId={appId} refreshKey={refreshKey} onAskAi={sendToSol} />
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
                  <div style={{ position: "absolute", inset: 0 }}>
                    <SettingsPane appId={appId} summary={summary} onRenamed={(name) => setSummary((s) => ({ ...s, name }))} />
                  </div>
                )}
              </>
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
          onClose={() => {
            setPublishOpen(false);
            publishWaiter.current?.reject(new Error("Publishing was closed before your app went live."));
            publishWaiter.current = null;
          }}
          onPublished={() => {
            publishWaiter.current?.resolve();
            publishWaiter.current = null;
            void refreshSummary();
            setRefreshKey((k) => k + 1);
          }}
        />
      )}

      {topUp && (
        <TopUpSheet
          pack={topUp}
          returnTo={`/dashboard/apps/${appId}`}
          startingCredits={credits}
          onClose={() => setTopUp(null)}
          onDone={(total) => {
            setTopUp(null);
            if (total !== null) setCredits(total);
            flash("Credits added.");
            const pending = outOfCredits;
            setOutOfCredits(null);
            pending?.resend();
          }}
        />
      )}

      {toast && (
        <div role="status" style={{ position: "fixed", bottom: 18, left: "50%", transform: "translateX(-50%)", zIndex: 70, padding: "0.55rem 0.9rem", borderRadius: 10, background: C.panelSolid, border: `1px solid ${C.borderStrong}`, fontSize: "0.8rem" }}>
          {toast}
        </div>
      )}

      <style>{`
        .ed-pulse { animation: ed-pulse 1.3s ease-in-out infinite; }
        @keyframes ed-pulse { 0%, 100% { opacity: 0.35; transform: scale(0.8); } 50% { opacity: 1; transform: scale(1); } }
        @media (max-width: 1280px) { .ed-tabs { margin-left: 12px !important; } }
        @media (max-width: 1100px) { .ed-top { flex-wrap: wrap; padding-top: 8px !important; padding-bottom: 8px !important; } .ed-tabs { order: 10; width: 100%; margin-left: 0 !important; overflow-x: auto; } .ed-code-preview { display: none !important; } }
        @media (max-width: 900px) {
          .ed-desktop { display: none !important; }
          .ed-mobile { display: flex !important; }
          .ed-chat, .ed-main { display: none !important; }
          .ed-chat.is-active, .ed-main.is-active { display: flex !important; width: 100% !important; border-right: none !important; }
        }
        @media (prefers-reduced-motion: reduce) { .ed-pulse { animation: none; } }
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
    <div style={{ borderTop: `1px solid color-mix(in srgb, ${tone} 33%, transparent)`, background: `color-mix(in srgb, ${tone} 7%, transparent)`, maxHeight: open ? "45%" : undefined, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0.5rem 0.8rem", fontSize: "0.8rem" }}>
        <Wrench size={14} color={tone} />
        <button type="button" onClick={() => setOpen((v) => !v)} style={{ background: "none", border: "none", color: C.text, cursor: "pointer", fontSize: "0.8rem", textAlign: "left", flex: 1, fontFamily: "inherit" }}>
          {count ? `${count} problem${count > 1 ? "s" : ""} in your app` : `${typeCount} small issue${typeCount > 1 ? "s" : ""} (the app still works)`} · {open ? "Hide" : "Show"}
        </button>
        <Button size="sm" variant="primary" onClick={props.onFixAll}>
          Fix it for me
        </Button>
      </div>
      {open && (
        <div style={{ overflow: "auto", padding: "0 0.8rem 0.6rem", display: "flex", flexDirection: "column", gap: 6 }}>
          {props.migrationFailure && (
            <ProblemRow title={`A change to your data didn't work${props.migrationFailure.line ? ` (line ${props.migrationFailure.line})` : ""}`} detail={props.migrationFailure.message} onFix={() => props.onFix({ message: `Migration ${props.migrationFailure!.name} failed: ${props.migrationFailure!.message}`, file: `db/migrations/${props.migrationFailure!.name}`, line: props.migrationFailure!.line })} onOpen={() => props.onOpenFile(`db/migrations/${props.migrationFailure!.name}`, props.migrationFailure!.line)} />
          )}
          {[...props.buildErrors, ...props.typeProblems].map((e, i) => (
            <ProblemRow key={`b${i}`} title={`${e.file ?? e.kind}${e.line ? `:${e.line}` : ""}`} detail={e.message} snippet={e.snippet} onFix={() => props.onFix({ message: e.message, file: e.file, line: e.line })} onOpen={e.file ? () => props.onOpenFile(e.file!, e.line) : undefined} />
          ))}
          {props.runtimeErrors.map((e, i) => (
            <ProblemRow key={`r${i}`} title={`While using ${e.url}`} detail={e.message} snippet={e.stack?.split("\n").slice(0, 3).join("\n")} onFix={() => props.onFix(e)} />
          ))}
          {props.runtimeErrors.length > 0 && (
            <button type="button" onClick={props.onDismissRuntime} style={{ alignSelf: "flex-start", background: "none", border: "none", color: C.muted, fontSize: "0.74rem", cursor: "pointer", fontFamily: "inherit" }}>
              Clear these
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
