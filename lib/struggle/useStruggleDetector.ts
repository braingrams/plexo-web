"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

import { StruggleDetector, type StruggleSignal } from "./detector";
import {
  canShowNudge, isGuidedStepPath, isInteractiveTarget, isPaymentField, isTypingTarget,
  onPaymentPath, readMemory, writeMemory,
} from "./policy";
import { STRUGGLE_EVENT } from "./events";

const FEEDBACK_URL = "/api/v1/feedback";

/**
 * Watches for signs the owner is stuck and says when to offer help. It only ever looks at
 * click positions, request status codes, page paths and the fact that an alert appeared.
 * It never reads what was typed, never reads request/response bodies, and records nothing.
 */
export function useStruggleDetector(userId: string, enabled = true) {
  const pathname = usePathname();
  const [signals, setSignals] = useState<StruggleSignal[]>([]);
  const [visible, setVisible] = useState(false);
  const det = useRef<StruggleDetector | null>(null);
  const shownThisSession = useRef(false);
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  if (!det.current) det.current = new StruggleDetector();

  // Path changes: feeds the back-and-forth detector and resets "stuck".
  useEffect(() => {
    if (!enabled || !pathname) return;
    det.current!.recordNavigation(Date.now(), pathname);
  }, [pathname, enabled]);

  const evaluate = useCallback(() => {
    const d = det.current!;
    const now = Date.now();
    if (shownThisSession.current || !d.isOverThreshold(now)) return;
    const active = document.activeElement as HTMLElement | null;
    const verdict = canShowNudge(now, readMemory(userId), {
      shownThisSession: shownThisSession.current,
      typing: isTypingTarget(active),
      onPaymentField: isPaymentField(active) || onPaymentPath(pathRef.current ?? ""),
      modalOpen: !!document.querySelector("[role='dialog'][aria-modal='true'], dialog[open]"),
    });
    if (!verdict.ok) return; // stays pending: the interval below retries while the score lasts
    shownThisSession.current = true;
    writeMemory(userId, { ...readMemory(userId), lastShownAt: now });
    setSignals(d.signals());
    setVisible(true);
    d.reset();
  }, [userId]);

  useEffect(() => {
    if (!enabled) return;
    const d = det.current!;
    const cleanups: (() => void)[] = [];
    const feed = (fn: () => boolean) => { if (fn()) evaluate(); };

    // Page changes that count as "something happened" for dead-click checks.
    let mutations = 0;
    const mo = new MutationObserver((records) => {
      for (const r of records) {
        if ((r.target as Element).closest?.("[data-feedback-root]")) continue;
        mutations++;
        // A new alert on screen: the same message twice is a signal.
        r.addedNodes.forEach((n) => {
          if (n.nodeType !== 1) return;
          const el = n as Element;
          const alert = el.matches?.("[role='alert']") ? el : el.querySelector?.("[role='alert']");
          const text = alert?.textContent;
          if (text && !el.closest("[data-feedback-root]")) feed(() => d.recordErrorMessage(Date.now(), text));
        });
      }
    });
    mo.observe(document.body, {
      subtree: true, childList: true, characterData: true,
      attributes: true, attributeFilter: ["class", "open", "aria-expanded", "hidden", "aria-hidden"],
    });
    cleanups.push(() => mo.disconnect());

    const onClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target || target.closest?.("[data-feedback-root]")) return;
      feed(() => d.recordClick(Date.now(), e.clientX, e.clientY));
      if (!isInteractiveTarget(target)) {
        const before = mutations;
        const path = pathRef.current;
        setTimeout(() => {
          if (mutations === before && pathRef.current === path) feed(() => d.recordDeadClick(Date.now()));
        }, 700);
      }
    };
    document.addEventListener("click", onClick, true);
    cleanups.push(() => document.removeEventListener("click", onClick, true));

    // Native validation errors (the same field failing twice).
    const onInvalid = (e: Event) => {
      const msg = (e.target as HTMLInputElement | null)?.validationMessage;
      if (msg) feed(() => d.recordErrorMessage(Date.now(), msg));
    };
    document.addEventListener("invalid", onInvalid, true);
    cleanups.push(() => document.removeEventListener("invalid", onInvalid, true));

    const onError = () => feed(() => d.recordJsError(Date.now()));
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onError);
    cleanups.push(() => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onError);
    });

    const onSignal = (e: Event) => {
      const s = (e as CustomEvent<{ signal?: string }>).detail?.signal;
      if (s === "boundary") feed(() => d.recordBoundary(Date.now()));
      else if (s === "js_error") feed(() => d.recordJsError(Date.now()));
    };
    window.addEventListener(STRUGGLE_EVENT, onSignal);
    cleanups.push(() => window.removeEventListener(STRUGGLE_EVENT, onSignal));

    // Typing counts as progress on a guided step.
    let lastKey = 0;
    const onKey = () => { lastKey = Date.now(); };
    document.addEventListener("keydown", onKey, true);
    cleanups.push(() => document.removeEventListener("keydown", onKey, true));

    // Observe our own failing requests. Status only: bodies are never touched.
    const origFetch = window.fetch;
    const isOurs = (url: string) => {
      try {
        const u = new URL(url, location.origin);
        return u.origin === location.origin && u.pathname !== FEEDBACK_URL;
      } catch { return false; }
    };
    window.fetch = async function patched(input: RequestInfo | URL, init?: RequestInit) {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const tracked = isOurs(url);
      try {
        const res = await origFetch.call(this, input, init);
        // 401 is a session timing out (the app handles it), not the owner struggling.
        if (tracked && res.status >= 400 && res.status !== 401) feed(() => d.recordFailedRequest(Date.now()));
        return res;
      } catch (err) {
        const aborted = err instanceof DOMException && err.name === "AbortError";
        if (tracked && !aborted) feed(() => d.recordFailedRequest(Date.now()));
        throw err;
      }
    };
    cleanups.push(() => { if (window.fetch !== origFetch) window.fetch = origFetch; });

    // Stuck: on a guided step, or something has said it is busy, for 90s with no movement.
    const tick = setInterval(() => {
      const waiting =
        isGuidedStepPath(pathRef.current ?? "") || !!document.querySelector("[aria-busy='true']");
      const typingRecently = Date.now() - lastKey < 20_000;
      feed(() => d.tickStuck(Date.now(), waiting && !typingRecently && document.visibilityState === "visible"));
      evaluate(); // retry a nudge that was held back (typing, modal)
    }, 5_000);
    cleanups.push(() => clearInterval(tick));

    return () => cleanups.forEach((c) => c());
  }, [enabled, evaluate]);

  const hide = useCallback(() => setVisible(false), []);
  const optOut = useCallback(() => {
    writeMemory(userId, { ...readMemory(userId), optedOut: true });
    setVisible(false);
  }, [userId]);

  return { visible, signals, hide, optOut, detectorSignals: () => det.current!.signals() };
}
