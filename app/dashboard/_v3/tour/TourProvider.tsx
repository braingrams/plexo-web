"use client";

import { otherDialogOpen } from "@/lib/dashboardV3/dialogs";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronRight, Compass, ListChecks, Route } from "lucide-react";
import {
  currentTourPosition,
  resolveTourSteps,
  routeMatches,
  sameRoute,
  shouldOfferTour,
  tourReducer,
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

const WAIT_FOR_ANCHOR_MS = 4000;

export function persistTourState(state: TourState) {
  void fetch("/api/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tourState: state }) }).catch(() => {});
}

/**
 * The walkthrough engine: asks first-timers if they want a tour, then spotlights one part of
 * the page at a time with a short plain description, moving across pages as it goes. State is
 * saved on every move, so it picks up where they left off (on any device).
 */
export function TourProvider({ initialState, onPersist, steps: registry = TOUR_STEPS, areas = TOUR_AREAS, context, offerOn = ["/dashboard"], initialDriving = false, children }: TourProviderProps) {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const search = useSearchParams()?.toString() ?? "";
  const [state, setState] = useState<TourState>(initialState);
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

  const api = useMemo<TourApi>(() => ({ state, openOffer: () => setOfferOpen(true), start, startArea, running: !!position && driving }), [state, start, startArea, position, driving]);

  // Move to the step's page when it lives elsewhere.
  const onStepPage = position ? routeMatches(position.step.route, pathname, search) : false;
  useEffect(() => {
    if (!position || !driving || onStepPage) return;
    router.push(position.step.route);
  }, [position, driving, onStepPage, router]);

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
        <ResumePill index={position.index} total={position.total} onResume={() => setDriving(true)} onStop={() => dispatch({ type: "skip" })} />
      ) : null}
      {position && driving && onStepPage ? (
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

function ResumePill({ index, total, onResume, onStop }: { index: number; total: number; onResume: () => void; onStop: () => void }) {
  return (
    <Portal>
      <div className="plx-toasts" style={{ pointerEvents: "none" }}>
        <div className="plx-toast plx-toast--info" role="region" aria-label="Tour">
          <Compass size={20} className="plx-toast__icon" aria-hidden />
          <div className="plx-toast__text">
            <span className="plx-toast__title">Your tour is waiting</span>
            <span className="plx-toast__desc">
              Step {index + 1} of {total}
            </span>
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
