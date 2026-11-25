"use client";

import { otherDialogOpen } from "@/lib/dashboardV3/dialogs";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronRight, Compass, ListChecks, Route } from "lucide-react";
import {
  absentKey,
  currentTourPosition,
  resolveTourSteps,
  routeKey,
  routeMatches,
  sameRoute,
  shellStepBlocked,
  shouldOfferTour,
  stepAfterRemoved,
  tourReducer,
  type HomeView,
  type ShellChrome,
  type TourViewport,
  type ResolvedTourStep,
  type TourAction,
  type TourContext,
  type TourMode,
  type TourState,
  type TourStep,
} from "@/lib/dashboardV3/tour";
import { TOUR_AREAS, TOUR_STEPS, type TourArea } from "@/lib/dashboardV3/tourSteps";
import { TOUR_STEP_EVENT } from "@/lib/dashboardV3/siteSwitcherEvents";
import { CoachMark } from "./CoachMark";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { Portal } from "../ui/portal";

type TourApi = {
  state: TourState;
  /** Open the "Want a quick tour?" question (the help menu's "Take the tour again"). */
  openOffer: () => void;
  start: (mode: TourMode) => void;
  /** Replay just one part of Plexo (an id from TOUR_AREAS). */
  startArea: (areaId: string, stepId?: string) => void;
  /** True while a step is on screen. */
  running: boolean;
  /** Home tells the tour which of its views is showing, so steps for things that view doesn't have are left out up front. null = Home was left (the last view is remembered). */
  reportHomeView: (view: HomeView | null) => void;
  /** The shell tells the tour what chrome the current page has (top bar, menu, folded or not). */
  reportShell: (chrome: ShellChrome) => void;
  /** A page says an anchor is (absent = true) or is not (false) on it for this person, so a step pointing only at it is left out up front instead of waited for. */
  reportAnchor: (routeScope: string, anchor: string, absent: boolean) => void;
};

const TourCtx = createContext<TourApi | null>(null);

export function useTour(): TourApi {
  const ctx = useContext(TourCtx);
  if (!ctx) throw new Error("useTour must be used inside TourProvider (mounted by the v3 shell).");
  return ctx;
}

/** Same as useTour, but null outside a TourProvider (for components that also render elsewhere). */
export function useOptionalTour(): TourApi | null {
  return useContext(TourCtx);
}

export type TourProviderProps = {
  initialState: TourState;
  /** Saves the state on the account (the profile API). Omit in previews. */
  onPersist?: (state: TourState) => void;
  steps?: TourStep[];
  areas?: TourArea[];
  context?: TourContext;
  /** Pages where a first-time visitor is asked "Want a quick tour?" (default: Home). */
  offerOn?: string[];
  /** Show an already-active tour immediately (instead of the "Your tour is waiting" pill). */
  initialDriving?: boolean;
  children: React.ReactNode;
};

const HOME = "/dashboard";
const HOME_WAIT_MS = 6000;

/** Phone <= 640, tablet <= 1023 (the dashboard's own breakpoints), else desktop. undefined until measured in the browser. */
function useViewport(): TourViewport | undefined {
  const [vp, setVp] = useState<TourViewport | undefined>(undefined);
  useEffect(() => {
    const phone = window.matchMedia("(max-width: 640px)");
    const tablet = window.matchMedia("(max-width: 1023px)");
    const read = () => setVp(phone.matches ? "phone" : tablet.matches ? "tablet" : "desktop");
    read();
    phone.addEventListener("change", read);
    tablet.addEventListener("change", read);
    return () => {
      phone.removeEventListener("change", read);
      tablet.removeEventListener("change", read);
    };
  }, []);
  return vp;
}

export function persistTourState(state: TourState) {
  void fetch("/api/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tourState: state }) }).catch(() => {});
}

/**
 * The walkthrough engine: asks first-timers if they want a tour, then spotlights one part of
 * the page at a time with a short plain description, moving across pages as it goes. State is
 * saved on every move, so it picks up where they left off (on any device).
 */
export function TourProvider({ initialState, onPersist, steps: registry = TOUR_STEPS, areas = TOUR_AREAS, context: baseContext, offerOn = ["/dashboard"], initialDriving = false, children }: TourProviderProps) {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const search = useSearchParams()?.toString() ?? "";
  const [state, setState] = useState<TourState>(initialState);
  // Which Home view was last on screen: Home renders different things per view, and the tour only offers steps that exist there.
  // The last one seen is kept after Home unmounts (so the step list stays right on other pages); homeMounted says Home is on screen now.
  const [homeView, setHomeView] = useState<HomeView | null>(null);
  const [homeMounted, setHomeMounted] = useState(false);
  // If Home could not be reached (it sent the person elsewhere), stop waiting for it and drop the steps that only Home has.
  const [homeGaveUp, setHomeGaveUp] = useState(false);
  const [chrome, setChrome] = useState<ShellChrome | null>(null);
  const viewport = useViewport();
  const [absent, setAbsent] = useState<string[]>([]);
  const reportHomeView = useCallback((view: HomeView | null) => {
    if (view) setHomeView(view);
    setHomeMounted(view !== null);
  }, []);
  const reportShell = useCallback((next: ShellChrome) => setChrome((prev) => (prev && prev.frame === next.frame && prev.sidebarMenu === next.sidebarMenu && prev.folded === next.folded && prev.tabbarSol === next.tabbarSol ? prev : next)), []);
  const reportAnchor = useCallback((routeScope: string, anchor: string, isAbsent: boolean) => {
    const key = absentKey(routeScope, anchor);
    setAbsent((list) => (list.includes(key) === isAbsent ? list : isAbsent ? [...list, key] : list.filter((k) => k !== key)));
  }, []);
  const effectiveHomeView: HomeView | null = homeView ?? (homeGaveUp ? "none" : null);
  const context = useMemo<TourContext>(
    () => ({ ...baseContext, ...(effectiveHomeView ? { homeView: effectiveHomeView } : {}), ...(viewport ? { viewport } : {}), ...(chrome ? { chrome } : {}), absent }),
    [baseContext, effectiveHomeView, viewport, chrome, absent],
  );
  const [offerOpen, setOfferOpen] = useState(false);
  // The offer opens by itself, so it steps aside while any other dialog is open and returns once that one closes.
  const [otherOpen, setOtherOpen] = useState(false);
  useEffect(() => {
    const check = () => setOtherOpen(otherDialogOpen(document, "plx-tour-offer"));
    check();
    const mo = new MutationObserver(check);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, []);
  // Only drive navigation once the person has pressed something in this visit; a tour left
  // "active" on another page offers to resume instead of whisking them away on load.
  const [driving, setDriving] = useState(initialDriving);
  const steps = useMemo(() => (state.mode ? resolveTourSteps(registry, state.mode, context, state.area) : []), [registry, state.mode, state.area, context]);
  const position = currentTourPosition(state, steps);
  // Home is the page the tour is offered on (the preview has its own).
  const homeRoute = offerOn[0] ?? HOME;
  const onHome = routeKey(pathname) === routeKey(homeRoute);
  // The list is only final once the tour knows the screen size and shell, and (when some step points at something only a Home view has)
  // which Home view this is. Until then nothing is shown, so no card ever waits for something that cannot appear and "N of M" is right.
  const needsHomeView = !effectiveHomeView && steps.some((s) => s.homeViews);
  const settled = !!viewport && !!chrome && !needsHomeView;

  const persistRef = useRef(onPersist);
  persistRef.current = onPersist;
  const dispatch = useCallback((action: TourAction) => {
    setState((s) => {
      const next = tourReducer(s, action);
      persistRef.current?.(next);
      return next;
    });
  }, []);

  // First arrival: ask once, and only when the screen itself is showing. /dashboard sometimes sends a returning person on to the
  // "Customize Plexo" setup first, so counting from the moment the route loads made the offer pop up and then vanish. Waiting
  // for the Home screen to appear (it marks itself with data-tour-ready) means the offer only ever shows where it belongs.
  const offeredRef = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    if (offeredRef.current || !shouldOfferTour(stateRef.current) || !offerOn.some((p) => sameRoute(p, pathname))) return;
    let timer: number | undefined;
    const arm = () => {
      offeredRef.current = true;
      timer = window.setTimeout(() => setOfferOpen(true), 600);
    };
    const mo = new MutationObserver(() => {
      if (document.querySelector("[data-tour-ready]")) {
        mo.disconnect();
        arm();
      }
    });
    if (document.querySelector("[data-tour-ready]")) arm();
    else mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      mo.disconnect();
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const start = useCallback(
    (mode: TourMode) => {
      setOfferOpen(false);
      setDriving(true);
      dispatch({ type: "start", mode, steps: resolveTourSteps(registry, mode, context) });
    },
    [dispatch, registry, context],
  );

  const startArea = useCallback(
    (areaId: string, stepId?: string) => {
      setOfferOpen(false);
      setDriving(true);
      dispatch({ type: "start", mode: "detailed", area: areaId, stepId, steps: resolveTourSteps(registry, "detailed", context, areaId) });
    },
    [dispatch, registry, context],
  );

  const resume = useCallback(() => {
    setOfferOpen(false);
    setDriving(true);
    if (state.stepId) dispatch({ type: "goto", stepId: state.stepId });
  }, [dispatch, state.stepId]);

  const api = useMemo<TourApi>(() => ({ state, openOffer: () => setOfferOpen(true), start, startArea, running: !!position && driving, reportHomeView, reportShell, reportAnchor }), [state, start, startArea, position, driving, reportHomeView, reportShell, reportAnchor]);

  // The list can change under a running tour (Home reports its view, a page says it lacks something): if the saved step is no
  // longer in it, carry on from the next one in order (not back at the start), or finish when it was the last.
  useEffect(() => {
    if (!settled || state.status !== "active" || !state.stepId || !steps.length || steps.some((s) => s.id === state.stepId)) return;
    const next = stepAfterRemoved(registry, state.stepId, steps);
    if (next) dispatch({ type: "goto", stepId: next.id });
    else dispatch({ type: "finish" });
  }, [settled, state.status, state.stepId, steps, registry, dispatch]);

  // Learning the Home view needs Home on screen: if the tour is running somewhere else, go there once.
  const triedHome = useRef(false);
  const waitingForHome = driving && state.status === "active" && needsHomeView && !homeGaveUp;
  useEffect(() => {
    if (!needsHomeView) triedHome.current = false;
    if (!waitingForHome || onHome || triedHome.current) return;
    triedHome.current = true;
    router.push(homeRoute);
  }, [waitingForHome, needsHomeView, onHome, router, homeRoute]);
  // If Home never says (it sent them on to another screen, or never loaded), stop waiting and carry on without the steps only Home has.
  useEffect(() => {
    if (!waitingForHome) return;
    const t = window.setTimeout(() => setHomeGaveUp(true), HOME_WAIT_MS);
    return () => window.clearTimeout(t);
  }, [waitingForHome]);

  // Move to the step's page when it lives elsewhere. A shell-wide step whose anchors are not on this page (the page editor,
  // SOL's chat list) moves to Home, where they are; if even Home lacks them (menu folded) the step is skipped, never waited for.
  const blocked = !!position && settled && shellStepBlocked(position.step, context);
  const onStepPage = position ? routeMatches(position.step.route, pathname, search) : false;
  useEffect(() => {
    if (!position || !driving || !settled) return;
    if (blocked) {
      if (onHome) dispatch({ type: "next", steps });
      else router.push(homeRoute);
      return;
    }
    if (!onStepPage) router.push(position.step.route);
  }, [position, driving, settled, blocked, onHome, onStepPage, router, dispatch, steps, homeRoute]);

  // A step that points at something only Home has is shown only while Home is on screen and has said which view it is.
  const homeStepReady = !position?.step.homeViews || homeMounted;
  // Never flash a stand-in step while the list is being repaired (the saved step just left it).
  const stepCurrent = position?.step.id === state.stepId;

  // Only the parts that exist for this person (no Store part for someone who can't have one).
  const offerAreas = useMemo(() => areas.filter((a) => resolveTourSteps(registry, "detailed", context, a.id).length > 0), [areas, registry, context]);
  // Tell parts of the page which step is showing (the site switcher opens itself for its step and closes after it).
  const showingId = position && driving && onStepPage ? position.step.id : null;
  useEffect(() => {
    window.dispatchEvent(new CustomEvent(TOUR_STEP_EVENT, { detail: { id: showingId } }));
  }, [showingId]);

  const canResume = state.status === "later" && !!state.stepId && !!state.mode;

  return (
    <TourCtx.Provider value={api}>
      {children}
      <TourOffer
        open={offerOpen && !otherOpen}
        canResume={canResume}
        areas={offerAreas}
        doneAreas={state.doneAreas ?? []}
        onArea={startArea}
        onPick={start}
        onResume={resume}
        onLater={() => {
          setOfferOpen(false);
          if (state.status === "unasked") dispatch({ type: "later" });
        }}
      />
      {position && !driving && state.status === "active" ? (
        <ResumePill index={settled && stepCurrent ? position.index : null} total={position.total} onResume={() => setDriving(true)} onStop={() => dispatch({ type: "skip" })} />
      ) : null}
      {position && driving && onStepPage && settled && !blocked && homeStepReady && stepCurrent ? (
        <CoachMark
          key={position.step.id}
          step={position.step}
          index={position.index}
          total={position.total}
          onNext={() => dispatch({ type: "next", steps })}
          onBack={() => dispatch({ type: "back", steps })}
          onSkip={() => dispatch({ type: "skip" })}
          onPause={() => {
            setDriving(false);
            dispatch({ type: "later" });
          }}
          onMissing={() => dispatch({ type: "next", steps })}
        />
      ) : null}
    </TourCtx.Provider>
  );
}

function TourOffer({ open, canResume, areas, doneAreas, onArea, onPick, onResume, onLater }: { open: boolean; canResume: boolean; areas: TourArea[]; doneAreas: string[]; onArea: (id: string) => void; onPick: (m: TourMode) => void; onResume: () => void; onLater: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onLater}
      title="Want a quick tour?"
      description="We'll point at each part of Plexo and say what it's for. Stop any time, and carry on later."
      width={640}
      footer={
        <>
          {canResume ? (
            <Button variant="secondary" onClick={onResume} leftIcon={<Route size={18} aria-hidden />}>
              Pick up where I left off
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onLater}>
            Later
          </Button>
        </>
      }
    >
      <div className="plx-tour-offer">
        <button type="button" className="plx-tour-choice" onClick={() => onPick("short")}>
          <span className="plx-tour-choice__icon">
            <Compass size={22} aria-hidden />
          </span>
          <span className="plx-tour-choice__title">Short tour</span>
          <span className="plx-tour-choice__desc">The key areas, in about a minute.</span>
        </button>
        <button type="button" className="plx-tour-choice" onClick={() => onPick("detailed")}>
          <span className="plx-tour-choice__icon">
            <ListChecks size={22} aria-hidden />
          </span>
          <span className="plx-tour-choice__title">Detailed tour</span>
          <span className="plx-tour-choice__desc">Every page one by one, including Settings.</span>
        </button>
      </div>
      {areas.length ? (
        <div className="plx-tour-areas">
          <p className="plx-tour-areas__h">Or go through just one part</p>
          <ul>
            {areas.map((a) => (
              <li key={a.id}>
                <button type="button" className="plx-tour-area" onClick={() => onArea(a.id)}>
                  <span className="plx-tour-area__txt">
                    <b>{a.title}</b>
                    <span>{a.desc}</span>
                  </span>
                  {doneAreas.includes(a.id) ? (
                    <span className="plx-tour-area__done"><Check size={14} strokeWidth={3} aria-hidden />Seen</span>
                  ) : null}
                  <ChevronRight size={18} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Modal>
  );
}

function ResumePill({ index, total, onResume, onStop }: { index: number | null; total: number; onResume: () => void; onStop: () => void }) {
  return (
    <Portal>
      <div className="plx-toasts" style={{ pointerEvents: "none" }}>
        <div className="plx-toast plx-toast--info" role="region" aria-label="Tour">
          <Compass size={20} className="plx-toast__icon" aria-hidden />
          <div className="plx-toast__text">
            <span className="plx-toast__title">Your tour is waiting</span>
            <span className="plx-toast__desc">{index === null ? "Pick up where you left off" : `Step ${index + 1} of ${total}`}</span>
          </div>
          <button type="button" className="plx-toast__action" onClick={onResume}>
            Continue
          </button>
          <button type="button" className="plx-toast__action" style={{ color: "inherit", opacity: 0.75 }} onClick={onStop}>
            End tour
          </button>
        </div>
      </div>
    </Portal>
  );
}
