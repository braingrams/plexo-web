"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Seconds left after `elapsedMs` of a cooldown that started with `total` seconds. Never below 0. */
export function secondsLeft(total: number, elapsedMs: number): number {
  return Math.max(0, Math.ceil(total - elapsedMs / 1000));
}

/** "0:45" style label for a number of seconds. */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** A resend cooldown: `left` counts down to 0, `restart()` begins it again. Starts running by default. */
export function useCountdown(total: number, startRunning = true): { left: number; restart: () => void } {
  const [startedAt, setStartedAt] = useState<number | null>(() => (startRunning ? Date.now() : null));
  const [left, setLeft] = useState(startRunning ? total : 0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (startedAt === null) return;
    const tick = () => {
      const next = secondsLeft(total, Date.now() - startedAt);
      setLeft(next);
      if (next === 0 && timer.current) clearInterval(timer.current);
    };
    tick();
    timer.current = setInterval(tick, 500);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [startedAt, total]);

  const restart = useCallback(() => { setLeft(total); setStartedAt(Date.now()); }, [total]);
  return { left, restart };
}
