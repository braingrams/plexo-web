"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { endNavProgress, startNavProgress } from "./NavProgress";

/**
 * The one way to move or refresh from code (not a link) so a tap is never met with silence.
 * The slim bar at the top starts at once, `pending` is true until the new page has really arrived
 * (use it for the button's spinner), and the bar completes by itself when it has.
 *
 *   const nav = useNavAction();
 *   <Button loading={nav.pending} onClick={() => nav.push("/dashboard/sites")}>
 *   <Button loading={nav.busy} onClick={() => nav.refreshAfter(() => save())}>   // save first, then refresh
 */
export function useNavAction() {
  const router = useRouter();
  const [inTransition, start] = useTransition();
  const [working, setWorking] = useState(false);
  const wasPending = useRef(false);

  // The page arrived (or the refresh finished): complete the bar.
  useEffect(() => {
    if (wasPending.current && !inTransition) endNavProgress();
    wasPending.current = inTransition;
  }, [inTransition]);

  const go = useCallback(
    (fn: () => void) => {
      startNavProgress();
      start(fn);
    },
    [],
  );
  const push = useCallback((href: string) => go(() => router.push(href)), [go, router]);
  const replace = useCallback((href: string) => go(() => router.replace(href)), [go, router]);
  const refresh = useCallback(() => go(() => router.refresh()), [go, router]);
  /** Move somewhere AND re-read the server data (a different workspace or site owns the page now). */
  const pushFresh = useCallback((href: string) => go(() => { router.push(href); router.refresh(); }), [go, router]);

  /**
   * Runs `job` (a save, a switch), then refreshes so the page shows the result. The bar and `busy` cover
   * both parts. Returns what the job returned; a job that returns `false` or throws skips the refresh.
   */
  const refreshAfter = useCallback(
    async <T,>(job: () => Promise<T> | T): Promise<T | undefined> => {
      startNavProgress();
      setWorking(true);
      try {
        const out = await job();
        if (out === false) {
          endNavProgress();
          return out;
        }
        start(() => router.refresh());
        return out;
      } catch (e) {
        endNavProgress();
        throw e;
      } finally {
        setWorking(false);
      }
    },
    [router],
  );

  return { pending: inTransition, busy: inTransition || working, push, replace, refresh, pushFresh, refreshAfter };
}
