/**
 * The product walkthrough's state machine and step registry (docs/redesign/SPEC.md "Help along
 * the way"). Pure: the client engine (app/dashboard/_v3/tour) renders it, the profile API
 * stores TourState on the user so the tour resumes across pages and devices.
 *
 * Adding steps: put an element anchor on the thing to explain (`data-tour="site-pages"`), then add
 * a step to TOUR_STEPS in lib/dashboardV3/tourSteps.ts with that anchor, the page it lives on, an
 * `order` (gaps of 10 leave room) and which tours include it.
 */
export type TourMode = "short" | "detailed";
export type TourStatus = "unasked" | "active" | "later" | "done" | "skipped";

export type TourState = {
  status: TourStatus;
  mode?: TourMode;
  /** The step they're on (an id, so adding steps later doesn't shift where they resume). */
  stepId?: string;
  /** When replaying one part ("settings", "site-pages"…), which part; absent = the whole tour. */
  area?: string;
  /** Parts they've been through to the end, so the Tour menu can tick them off. */
  doneAreas?: string[];
  updatedAt?: string;
};

/**
 * What Home is showing right now. Home renders a different set of things per view, so a step that points
 * at something only one view has (the numbers tiles, the "next step" card) must only be offered there.
 * guided = setup steps still to do; live = the site is online and shows its numbers; quiet = online but its numbers could not load; all = the every-site
 * list (pros and people with several sites); none = no site yet.
 */
export type HomeView = "guided" | "finishing" | "live" | "quiet" | "all" | "none";

/** How wide the screen is, matching the dashboard's own breakpoints: phone <= 640, tablet <= 1023 (menu in a bottom bar), desktop above. */
export type TourViewport = "phone" | "tablet" | "desktop";

/**
 * What the shell is showing on the current page (reported by the shell itself), so shell-wide steps are only
 * offered where their anchor exists. `frame`: full = top bar + menu; editor = the page editor (menu only, folded);
 * none = no dashboard chrome at all (a hosted app screen).
 */
export type ShellChrome = {
  frame: "full" | "editor" | "none";
  /** The desktop sidebar is showing the main menu (not SOL's conversation list). */
  sidebarMenu: boolean;
  /** The desktop sidebar is folded to icons (the site switcher is hidden then). */
  folded: boolean;
  /** "Ask SOL" is one of the buttons in the phone's bottom bar. */
  tabbarSol: boolean;
};

export type TourContext = {
  /** Which Home view is on screen (reported by Home itself). Unknown until Home has been seen: then no step is filtered by it. */
  homeView?: HomeView;
  /** The site the beginner view is showing, for steps that live on a site's own pages. */
  siteId?: string | null;
  experience?: "beginner" | "intermediate" | "pro";
  /** What kind of site that is, so steps about tabs it doesn't have (Products on a blog) are left out. */
  siteKind?: string | null;
  /** The screen size class (reported by the tour engine): steps whose anchors are hidden at that size are left out. */
  viewport?: TourViewport;
  /** What the shell shows right now; see ShellChrome. */
  chrome?: ShellChrome;
  /** Anchors a page has said it does not render for this person, as "route|anchor" keys (see absentKey). Steps that only point at those are left out. */
  absent?: readonly string[];
};

/** The page identity used to scope "this page does not show that": path plus the site tab; trailing slash and the default Pages tab are ignored. */
export function routeKey(pathname: string, search: string = ""): string {
  const [pathPart, rest] = pathname.split("#")[0].split("?") as [string, string | undefined];
  const path = pathPart.replace(/\/+$/, "") || "/";
  const tab = new URLSearchParams(rest ?? search).get("tab");
  return tab && tab !== "pages" ? `${path}?tab=${tab}` : path;
}

export const absentKey = (route: string, anchor: string) => `${routeKey(route)}|${anchor}`;

/** The anchors a step points at, in order (the first visible one is where the card sits). */
export function stepAnchors(step: Pick<TourStep, "anchor" | "anchors">): string[] {
  return step.anchors?.length ? step.anchors : [step.anchor];
}

/** Hidden by the layout at a screen size or shell state, whatever page it is: no point offering a step that points only at these. */
export function anchorHiddenByLayout(anchor: string, ctx: Pick<TourContext, "viewport" | "chrome">): boolean {
  const narrow = ctx.viewport === "phone" || ctx.viewport === "tablet";
  if (narrow && anchor === "theme-switch") return true; // the top-bar appearance switch is desktop-only; narrow screens have it inside More
  if (ctx.viewport === "desktop" && ctx.chrome?.frame === "full" && ctx.chrome.folded && (anchor === "site-switcher" || anchor === "site-switcher-panel")) return true;
  return false;
}

/** Is this anchor on screen on the page the shell is showing right now? Unknown shell state counts as yes. */
export function anchorOnThisPage(anchor: string, ctx: Pick<TourContext, "viewport" | "chrome">): boolean {
  const c = ctx.chrome;
  if (!c || !ctx.viewport) return true;
  if (c.frame === "none") return false;
  const narrow = ctx.viewport !== "desktop";
  switch (anchor) {
    case "main-nav":
      return narrow ? c.frame === "full" : c.sidebarMenu;
    case "site-switcher":
      return narrow ? c.frame === "full" : c.sidebarMenu && !c.folded;
    case "site-switcher-panel":
      return !narrow && c.sidebarMenu && !c.folded;
    case "ask-sol":
    case "help-menu":
      return c.frame === "full";
    case "theme-switch":
      return !narrow && c.frame === "full";
    case "ask-sol-menu":
      return narrow ? c.tabbarSol : c.sidebarMenu;
    default:
      return true;
  }
}

/** A shell-wide step none of whose anchors exist on the page the person is on (the page editor, a hosted app, SOL's chat list). */
export function shellStepBlocked(step: Pick<ResolvedTourStep, "route" | "anchor" | "anchors">, ctx: Pick<TourContext, "viewport" | "chrome">): boolean {
  if (step.route !== "*") return false;
  return !stepAnchors(step).some((a) => anchorOnThisPage(a, ctx));
}

/** The site tabs a kind of site shows (mirrors lib/dashboardV3/hubTabs.ts hubTabs; a store that also blogs just skips Blog at the screen). */
export function siteTabsForKind(kind: string | null | undefined, experience?: string): string[] {
  if (kind === "Server app" || kind === "Uploaded app") return ["app", "address", "visits", "health", "settings", "more", ...(experience === "pro" ? ["advanced"] : [])];
  const tabs = ["pages"];
  if (kind === "Online store") tabs.push("products", "orders");
  if (kind === "Blog") tabs.push("blog");
  if (kind === "Course") tabs.push("course");
  tabs.push("brand", "address", "visits", "health", "settings", "more");
  if (experience === "pro") tabs.push("advanced");
  return tabs;
}

export type TourStep = {
  id: string;
  /** Matches an element's `data-tour` attribute. Missing on screen → the step is skipped. */
  anchor: string;
  /** Point at several things at once (the top bar box AND the menu item). The first one on screen is where the card sits; hidden ones are never waited for. Defaults to just `anchor`. */
  anchors?: string[];
  /** The page it lives on ("*" = any page: shell-wide things), or a function of the context; null = skip it. */
  route: string | ((ctx: TourContext) => string | null);
  title: string;
  body: string;
  tours: TourMode[];
  /** Which part of Plexo this belongs to (an id from TOUR_AREAS), so people can replay just that part. */
  area?: string;
  order: number;
  /** A site tab this step is about: left out for sites that don't have that tab. */
  siteTab?: string;
  /** Only on these Home views (set it on steps that point at something Home shows in some views only). Default: every view. */
  homeViews?: HomeView[];
  /** Draw SOL's mark beside the title, for the step that introduces SOL. */
  mascot?: "sol";
  /** Not shown on phones (e.g. it points at a panel that takes the whole bottom of a phone screen). */
  desktopOnly?: boolean;
  placement?: "top" | "bottom" | "left" | "right" | "auto";
  /** Only for these experience levels (e.g. Developers is pro-only). Default: everyone. */
  experiences?: ("beginner" | "intermediate" | "pro")[];
};

export type ResolvedTourStep = Omit<TourStep, "route"> & { route: string };

export const INITIAL_TOUR_STATE: TourState = { status: "unasked" };

export function resolveTourSteps(registry: readonly TourStep[], mode: TourMode, ctx: TourContext = {}, area?: string): ResolvedTourStep[] {
  const out: ResolvedTourStep[] = [];
  for (const step of [...registry].sort((a, b) => a.order - b.order)) {
    // Replaying one part includes every step of that part, short or detailed.
    if (area ? step.area !== area : !step.tours.includes(mode)) continue;
    if (step.experiences && ctx.experience && !step.experiences.includes(ctx.experience)) continue;
    if (step.homeViews && ctx.homeView && !step.homeViews.includes(ctx.homeView)) continue;
    if (step.desktopOnly && ctx.viewport === "phone") continue;
    if (step.siteTab && ctx.siteKind && !siteTabsForKind(ctx.siteKind, ctx.experience).includes(step.siteTab)) continue;
    const route = typeof step.route === "function" ? step.route(ctx) : step.route;
    if (!route) continue;
    // Up front: only anchors this screen size can show, and none a page has said it does not render for this person.
    const anchors = stepAnchors(step).filter((a) => !anchorHiddenByLayout(a, ctx) && !(route !== "*" && ctx.absent?.includes(absentKey(route, a))));
    if (!anchors.length) continue;
    out.push({ ...step, anchor: anchors[0], anchors, route });
  }
  return out;
}

/**
 * The step to carry on from when the one they were on has just left the list (Home reported a view without it, a page said it
 * does not have it): the next one in order, null = it was the last. A step id that no longer exists at all restarts from the first.
 */
export function stepAfterRemoved(registry: readonly TourStep[], removedId: string, steps: readonly ResolvedTourStep[]): ResolvedTourStep | null {
  const gone = registry.find((s) => s.id === removedId);
  if (!gone) return steps[0] ?? null;
  return steps.find((s) => s.order > gone.order) ?? null;
}

/** Ask "Want a quick tour?" only the first time they arrive. */
export function shouldOfferTour(state: TourState | null | undefined): boolean {
  return !state || state.status === "unasked";
}

export type TourAction =
  | { type: "start"; mode: TourMode; steps: ResolvedTourStep[]; area?: string; /** Begin here instead of at the first step. */ stepId?: string }
  | { type: "next"; steps: ResolvedTourStep[] }
  | { type: "back"; steps: ResolvedTourStep[] }
  | { type: "goto"; stepId: string }
  | { type: "later" }
  | { type: "skip" }
  | { type: "finish" };

function withDone(state: TourState, area: string | undefined): string[] | undefined {
  if (!area) return state.doneAreas;
  return [...new Set([...(state.doneAreas ?? []), area])];
}

/** Keeps what they've completed across every move; `area` only lives while that part is running. */
export function tourReducer(state: TourState, action: TourAction, now: string = new Date().toISOString()): TourState {
  const keep = state.doneAreas ? { doneAreas: state.doneAreas } : {};
  switch (action.type) {
    case "start":
      if (!action.steps.length) return { status: "done", mode: action.mode, ...keep, updatedAt: now };
      return { status: "active", mode: action.mode, stepId: action.steps.find((x) => x.id === action.stepId)?.id ?? action.steps[0].id, ...(action.area ? { area: action.area } : {}), ...keep, updatedAt: now };
    case "next": {
      const i = action.steps.findIndex((s) => s.id === state.stepId);
      const next = action.steps[i + 1];
      if (!next) return { status: "done", mode: state.mode, ...(state.area ? { doneAreas: withDone(state, state.area) } : keep), updatedAt: now };
      return { ...state, status: "active", stepId: next.id, updatedAt: now };
    }
    case "back": {
      const i = action.steps.findIndex((s) => s.id === state.stepId);
      if (i <= 0) return state;
      return { ...state, stepId: action.steps[i - 1].id, updatedAt: now };
    }
    case "goto":
      return { ...state, status: "active", stepId: action.stepId, updatedAt: now };
    case "later":
      return { status: "later", mode: state.mode, stepId: state.stepId, ...(state.area ? { area: state.area } : {}), ...keep, updatedAt: now };
    case "skip":
      return { status: "skipped", mode: state.mode, ...keep, updatedAt: now };
    case "finish":
      return { status: "done", mode: state.mode, ...(state.area ? { doneAreas: withDone(state, state.area) } : keep), updatedAt: now };
  }
}

/** Where an active tour is: the step, its position, and whether it's on another page. */
export function currentTourPosition(state: TourState, steps: ResolvedTourStep[]): { step: ResolvedTourStep; index: number; total: number } | null {
  if (state.status !== "active") return null;
  const index = steps.findIndex((s) => s.id === state.stepId);
  if (index < 0) return steps.length ? { step: steps[0], index: 0, total: steps.length } : null;
  return { step: steps[index], index, total: steps.length };
}

/** Same route, ignoring a trailing slash and the query string. A step route of "*" matches any page. */
export function sameRoute(a: string, b: string): boolean {
  if (a === "*" || b === "*") return true;
  const norm = (p: string) => p.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  return norm(a) === norm(b);
}

/**
 * Same page AND, when the step names a tab (`?tab=products`), the same tab. A step with no query
 * matches the page whichever tab is open. `search` is the current `location.search`.
 */
export function routeMatches(stepRoute: string, pathname: string, search: string = ""): boolean {
  if (!sameRoute(stepRoute, pathname)) return false;
  const q = stepRoute.split("#")[0].split("?")[1];
  if (!q) return true;
  const want = new URLSearchParams(q);
  const have = new URLSearchParams(search);
  for (const [k, v] of want) {
    const got = have.get(k) ?? (k === "tab" ? "pages" : "");
    if (got !== v) return false;
  }
  return true;
}

const STATUSES: readonly TourStatus[] = ["unasked", "active", "later", "done", "skipped"];

/** What the profile API accepts for tourState. */
export function sanitizeTourState(input: unknown): TourState | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  if (typeof raw.status !== "string" || !(STATUSES as readonly string[]).includes(raw.status)) return null;
  const out: TourState = { status: raw.status as TourStatus, updatedAt: new Date().toISOString() };
  if (raw.mode === "short" || raw.mode === "detailed") out.mode = raw.mode;
  if (typeof raw.stepId === "string" && /^[a-z0-9-]{1,64}$/.test(raw.stepId)) out.stepId = raw.stepId;
  if (typeof raw.area === "string" && /^[a-z0-9-]{1,40}$/.test(raw.area)) out.area = raw.area;
  if (Array.isArray(raw.doneAreas)) {
    const ids = raw.doneAreas.filter((a): a is string => typeof a === "string" && /^[a-z0-9-]{1,40}$/.test(a)).slice(0, 40);
    if (ids.length) out.doneAreas = [...new Set(ids)];
  }
  return out;
}

export function readTourState(stored: unknown): TourState {
  const state = sanitizeTourState(stored);
  if (!state) return INITIAL_TOUR_STATE;
  const updatedAt = (stored as { updatedAt?: unknown }).updatedAt;
  return { ...state, updatedAt: typeof updatedAt === "string" ? updatedAt : undefined };
}
