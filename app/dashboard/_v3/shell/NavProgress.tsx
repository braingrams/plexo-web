"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { isInternalNavigation, nextProgress, routeKey } from "@/lib/dashboardV3/navProgress";

/** Anything can call this to start the bar (for example before a router.push that is not a link). */
export const NAV_START_EVENT = "plx:navstart";
export function startNavProgress() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(NAV_START_EVENT));
}
/** The other half: something that is not a route change (a refresh, a switch) has finished, so the bar can complete. */
export const NAV_END_EVENT = "plx:navend";
export function endNavProgress() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(NAV_END_EVENT));
}

/** The longest the bar waits for a page before it gives up quietly (a slow page, a failed fetch). */
const GIVE_UP_MS = 20000;

type Phase = "idle" | "running" | "done";

function Bar() {
  const pathname = usePathname();
  const search = useSearchParams();
  const key = routeKey(pathname, search?.toString());
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const phaseRef = useRef<Phase>("idle");
  const keyRef = useRef(key);
  const timers = useRef<{ tick?: ReturnType<typeof setInterval>; giveUp?: ReturnType<typeof setTimeout>; hide?: ReturnType<typeof setTimeout> }>({});

  const set = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
    // The page behind the bar softens (after a short beat, so quick moves never flicker) until it has arrived.
    if (typeof document !== "undefined") {
      if (p === "running") document.documentElement.setAttribute("data-plx-nav", "running");
      else document.documentElement.removeAttribute("data-plx-nav");
    }
  };
  const clear = () => {
    clearInterval(timers.current.tick);
    clearTimeout(timers.current.giveUp);
    clearTimeout(timers.current.hide);
  };
  const finish = () => {
    if (phaseRef.current !== "running") return;
    clear();
    setProgress(100);
    set("done");
    timers.current.hide = setTimeout(() => {
      set("idle");
      setProgress(0);
    }, 380);
  };
  const start = () => {
    clear();
    setProgress(8);
    set("running");
    timers.current.tick = setInterval(() => setProgress((p) => nextProgress(p)), 180);
    timers.current.giveUp = setTimeout(finish, GIVE_UP_MS);
  };

  // A click on a link that goes somewhere else in the app: start at once.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a) return;
      const loc = window.location;
      const go = isInternalNavigation(
        { href: a.getAttribute("href"), target: a.getAttribute("target"), download: a.hasAttribute("download"), button: e.button, metaKey: e.metaKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey },
        { origin: loc.origin, pathname: loc.pathname, search: loc.search },
      );
      if (go) start();
    };
    const onStart = () => start();
    const onEnd = () => finish();
    document.addEventListener("click", onClick);
    window.addEventListener(NAV_START_EVENT, onStart);
    window.addEventListener(NAV_END_EVENT, onEnd);
    return () => {
      document.removeEventListener("click", onClick);
      window.removeEventListener(NAV_START_EVENT, onStart);
      window.removeEventListener(NAV_END_EVENT, onEnd);
      clear();
    };
    // start/finish only use refs and setters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The route (page, tab or section) changed: the page has arrived.
  useEffect(() => {
    if (keyRef.current === key) return;
    keyRef.current = key;
    finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <div className="plx-navp" data-phase={phase} aria-hidden>
      <div className="plx-navp__bar" style={{ transform: `scaleX(${progress / 100})` }} />
    </div>
  );
}

/** A slim brand-coloured bar across the top of the dashboard: starts the instant an internal link is clicked, finishes when the page has changed. */
export function NavProgress() {
  return (
    <Suspense fallback={null}>
      <Bar />
    </Suspense>
  );
}
