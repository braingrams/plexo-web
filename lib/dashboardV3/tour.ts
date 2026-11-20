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

export type TourContext = {
  /** The site the beginner view is showing, for steps that live on a site's own pages. */
  siteId?: string | null;
  experience?: "beginner" | "intermediate" | "pro";
  /** What kind of site that is, so steps about tabs it doesn't have (Products on a blog) are left out. */
  siteKind?: string | null;
};

/** The site tabs a kind of site shows (mirrors lib/dashboardV3/hubTabs.ts hubTabs; a store that also blogs just skips Blog at the screen). */
export function siteTabsForKind(kind: string | null | undefined, experience?: string): string[] {
  if (kind === "Server app" || kind === "Uploaded app") return ["app", "address", "visits", "health", "settings", ...(experience === "pro" ? ["advanced"] : [])];
  const tabs = ["pages"];
  if (kind === "Online store") tabs.push("products", "orders");
  if (kind === "Blog") tabs.push("blog");
  if (kind === "Course") tabs.push("course");
  tabs.push("brand", "address", "visits", "health", "settings");
  if (experience === "pro") tabs.push("advanced");
  return tabs;
}

export type TourStep = {
  id: string;
  /** Matches an element's `data-tour` attribute. Missing on screen → the step is skipped. */
  anchor: string;
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
    if (step.siteTab && ctx.siteKind && !siteTabsForKind(ctx.siteKind, ctx.experience).includes(step.siteTab)) continue;
    const route = typeof step.route === "function" ? step.route(ctx) : step.route;
    if (!route) continue;
    out.push({ ...step, route });
  }
  return out;
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
