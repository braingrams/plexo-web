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
  updatedAt?: string;
};

export type TourContext = {
  /** The site the beginner view is showing, for steps that live on a site's own pages. */
  siteId?: string | null;
  experience?: "beginner" | "intermediate" | "pro";
};

export type TourStep = {
  id: string;
  /** Matches an element's `data-tour` attribute. Missing on screen → the step is skipped. */
  anchor: string;
  /** The page it lives on ("*" = any page: shell-wide things), or a function of the context; null = skip it. */
  route: string | ((ctx: TourContext) => string | null);
  title: string;
  body: string;
  tours: TourMode[];
  order: number;
  placement?: "top" | "bottom" | "left" | "right" | "auto";
  /** Only for these experience levels (e.g. Developers is pro-only). Default: everyone. */
  experiences?: ("beginner" | "intermediate" | "pro")[];
};

export type ResolvedTourStep = Omit<TourStep, "route"> & { route: string };

export const INITIAL_TOUR_STATE: TourState = { status: "unasked" };

export function resolveTourSteps(registry: readonly TourStep[], mode: TourMode, ctx: TourContext = {}): ResolvedTourStep[] {
  const out: ResolvedTourStep[] = [];
  for (const step of [...registry].sort((a, b) => a.order - b.order)) {
    if (!step.tours.includes(mode)) continue;
    if (step.experiences && ctx.experience && !step.experiences.includes(ctx.experience)) continue;
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
  | { type: "start"; mode: TourMode; steps: ResolvedTourStep[] }
  | { type: "next"; steps: ResolvedTourStep[] }
  | { type: "back"; steps: ResolvedTourStep[] }
  | { type: "goto"; stepId: string }
  | { type: "later" }
  | { type: "skip" }
  | { type: "finish" };

export function tourReducer(state: TourState, action: TourAction, now: string = new Date().toISOString()): TourState {
  switch (action.type) {
    case "start":
      if (!action.steps.length) return { status: "done", mode: action.mode, updatedAt: now };
      return { status: "active", mode: action.mode, stepId: action.steps[0].id, updatedAt: now };
    case "next": {
      const i = action.steps.findIndex((s) => s.id === state.stepId);
      const next = action.steps[i + 1];
      if (!next) return { status: "done", mode: state.mode, updatedAt: now };
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
      return { status: "later", mode: state.mode, stepId: state.stepId, updatedAt: now };
    case "skip":
      return { status: "skipped", mode: state.mode, updatedAt: now };
    case "finish":
      return { status: "done", mode: state.mode, updatedAt: now };
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

const STATUSES: readonly TourStatus[] = ["unasked", "active", "later", "done", "skipped"];

/** What the profile API accepts for tourState. */
export function sanitizeTourState(input: unknown): TourState | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  if (typeof raw.status !== "string" || !(STATUSES as readonly string[]).includes(raw.status)) return null;
  const out: TourState = { status: raw.status as TourStatus, updatedAt: new Date().toISOString() };
  if (raw.mode === "short" || raw.mode === "detailed") out.mode = raw.mode;
  if (typeof raw.stepId === "string" && /^[a-z0-9-]{1,64}$/.test(raw.stepId)) out.stepId = raw.stepId;
  return out;
}

export function readTourState(stored: unknown): TourState {
  const state = sanitizeTourState(stored);
  if (!state) return INITIAL_TOUR_STATE;
  const updatedAt = (stored as { updatedAt?: unknown }).updatedAt;
  return { ...state, updatedAt: typeof updatedAt === "string" ? updatedAt : undefined };
}
