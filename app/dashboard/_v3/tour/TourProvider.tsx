"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Compass, ListChecks, Route } from "lucide-react";
import {
  currentTourPosition,
  resolveTourSteps,
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
import { TOUR_STEPS } from "@/lib/dashboardV3/tourSteps";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { Portal, trapTab } from "../ui/portal";

type TourApi = {
  state: TourState;
  /** Open the "Want a quick tour?" question (the help menu's "Take the tour again"). */
  openOffer: () => void;
  start: (mode: TourMode) => void;
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
  context?: TourContext;
  /** Pages where a first-time visitor is asked "Want a quick tour?" (default: Home). */
  offerOn?: string[];
  /** Show an already-active tour immediately (instead of the "Your tour is waiting" pill). */
  initialDriving?: boolean;
  children: React.ReactNode;
};

const WAIT_FOR_ANCHOR_MS = 4000;

function visibleAnchor(anchor: string): HTMLElement | null {
  const all = document.querySelectorAll<HTMLElement>(`[data-tour="${CSS.escape(anchor)}"]`);
  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden") return el;
  }
  return null;
}

export function persistTourState(state: TourState) {
  void fetch("/api/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tourState: state }) }).catch(() => {});
}

/**
 * The walkthrough engine: asks first-timers if they want a tour, then spotlights one part of
 * the page at a time with a short plain description, moving across pages as it goes. State is
 * saved on every move, so it picks up where they left off (on any device).
 */
export function TourProvider({ initialState, onPersist, steps: registry = TOUR_STEPS, context, offerOn = ["/dashboard"], initialDriving = false, children }: TourProviderProps) {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const [state, setState] = useState<TourState>(initialState);
  const [offerOpen, setOfferOpen] = useState(false);
  // Only drive navigation once the person has pressed something in this visit; a tour left
  // "active" on another page offers to resume instead of whisking them away on load.
  const [driving, setDriving] = useState(initialDriving);
  const steps = useMemo(() => (state.mode ? resolveTourSteps(registry, state.mode, context) : []), [registry, state.mode, context]);
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

  // First arrival: ask once.
  useEffect(() => {
    if (shouldOfferTour(initialState) && offerOn.some((p) => sameRoute(p, pathname))) {
      const t = window.setTimeout(() => setOfferOpen(true), 600);
      return () => window.clearTimeout(t);
    }
    // Only on first mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = useCallback(
    (mode: TourMode) => {
      setOfferOpen(false);
      setDriving(true);
      dispatch({ type: "start", mode, steps: resolveTourSteps(registry, mode, context) });
    },
    [dispatch, registry, context],
  );

  const resume = useCallback(() => {
    setOfferOpen(false);
    setDriving(true);
    if (state.stepId) dispatch({ type: "goto", stepId: state.stepId });
  }, [dispatch, state.stepId]);

  const api = useMemo<TourApi>(() => ({ state, openOffer: () => setOfferOpen(true), start, running: !!position && driving }), [state, start, position, driving]);

  // Move to the step's page when it lives elsewhere.
  const onStepPage = position ? sameRoute(position.step.route, pathname) : false;
  useEffect(() => {
    if (!position || !driving || onStepPage) return;
    router.push(position.step.route);
  }, [position, driving, onStepPage, router]);

  const canResume = state.status === "later" && !!state.stepId && !!state.mode;

  return (
    <TourCtx.Provider value={api}>
      {children}
      <TourOffer
        open={offerOpen}
        canResume={canResume}
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

function TourOffer({ open, canResume, onPick, onResume, onLater }: { open: boolean; canResume: boolean; onPick: (m: TourMode) => void; onResume: () => void; onLater: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onLater}
      title="Want a quick tour?"
      description="We'll point out each part of Plexo and what it's for. You can stop any time."
      width={600}
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

type Rect = { top: number; left: number; width: number; height: number };
const PAD = 8;
const GAP = 14;

function CoachMark({ step, index, total, onNext, onBack, onSkip, onPause, onMissing }: { step: ResolvedTourStep; index: number; total: number; onNext: () => void; onBack: () => void; onSkip: () => void; onPause: () => void; onMissing: () => void }) {
  const [rect, setRect] = useState<Rect | null>(null);
  const [cardPos, setCardPos] = useState<{ top: number; left: number } | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const target = useRef<HTMLElement | null>(null);
  const last = index === total - 1;

  // Find the anchor (it may still be rendering after a page change), then follow it.
  useEffect(() => {
    let cancelled = false;
    const startedAt = Date.now();
    let timer = 0;
    const measure = () => {
      const el = target.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setRect({ top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 });
    };
    const find = () => {
      if (cancelled) return;
      const el = visibleAnchor(step.anchor);
      if (el) {
        target.current = el;
        const r = el.getBoundingClientRect();
        if (r.top < 80 || r.bottom > window.innerHeight - 80) el.scrollIntoView({ block: "center", behavior: "smooth" });
        measure();
        window.setTimeout(measure, 350);
        return;
      }
      if (Date.now() - startedAt > WAIT_FOR_ANCHOR_MS) onMissing();
      else timer = window.setTimeout(find, 120);
    };
    find();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
    // onMissing is stable enough per step (keyed by step id).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.anchor]);

  // Put the card next to the spotlight: below, else above, else beside; always on screen.
  useLayoutEffect(() => {
    if (!rect || !card.current) return;
    const c = card.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const clampX = (x: number) => Math.max(16, Math.min(x, vw - c.width - 16));
    const clampY = (y: number) => Math.max(16, Math.min(y, vh - c.height - 16));
    let top: number;
    let left: number;
    if (rect.top + rect.height + GAP + c.height < vh - 16 && step.placement !== "top") {
      top = rect.top + rect.height + GAP;
      left = clampX(rect.left);
    } else if (rect.top - GAP - c.height > 16) {
      top = rect.top - GAP - c.height;
      left = clampX(rect.left);
    } else if (rect.left + rect.width + GAP + c.width < vw - 16) {
      top = clampY(rect.top);
      left = rect.left + rect.width + GAP;
    } else {
      top = clampY(rect.top + 24);
      left = clampX(rect.left - c.width - GAP);
    }
    setCardPos({ top, left });
  }, [rect, step.placement]);

  useEffect(() => {
    card.current?.focus();
  }, [step.id]);

  const onKey = (e: React.KeyboardEvent) => {
    if (trapTab(e, card.current)) return;
    if (e.key === "Escape") {
      e.preventDefault();
      onPause();
    } else if (e.key === "ArrowRight") onNext();
    else if (e.key === "ArrowLeft" && index > 0) onBack();
  };

  return (
    <Portal>
      <div className="plx-tour-shield" aria-hidden onClick={(e) => e.stopPropagation()} />
      {rect ? <div className="plx-tour-spot" style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }} aria-hidden /> : null}
      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`tour-${step.id}-title`}
        aria-describedby={`tour-${step.id}-body`}
        tabIndex={-1}
        className="plx-tour-card"
        style={{ top: cardPos?.top ?? -9999, left: cardPos?.left ?? -9999, visibility: rect && cardPos ? "visible" : "hidden" }}
        onKeyDown={onKey}
      >
        <div className="plx-tour-card__top">
          <span className="plx-tour-card__step">
            {index + 1} of {total}
          </span>
          <button type="button" className="plx-tour-card__skip" onClick={onSkip}>
            Skip tour
          </button>
        </div>
        <h2 id={`tour-${step.id}-title`} className="plx-tour-card__title">
          {step.title}
        </h2>
        <p id={`tour-${step.id}-body`} className="plx-tour-card__body">
          {step.body}
        </p>
        <div className="plx-tour-card__foot">
          <div className="plx-tour-dots" aria-hidden>
            {Array.from({ length: total }, (_, i) => (
              <span key={i} data-on={i === index} data-done={i < index} />
            ))}
          </div>
          <div className="plx-tour-card__btns">
            {index > 0 ? (
              <Button variant="secondary" size="sm" onClick={onBack}>
                Back
              </Button>
            ) : null}
            <Button size="sm" onClick={onNext}>
              {last ? "Finish" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
