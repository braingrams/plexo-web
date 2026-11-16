/**
 * Struggle detector: pure, clock-injected logic that decides when a signed-in owner
 * seems to be having a hard time. No DOM, no storage, no network: the client hook feeds
 * it plain events (a click position, a status code, a path) and it keeps a decaying
 * score. Nothing here ever sees page content, form values, or request/response bodies.
 */

export type StruggleSignal =
  | "rage_click"
  | "dead_click"
  | "failed_requests"
  | "repeated_error"
  | "js_error"
  | "boundary"
  | "stuck"
  | "nav_loop";

/** Points each signal adds when it trips. One signal alone is rarely enough: two, or a repeat, is. */
export const SIGNAL_WEIGHTS: Record<StruggleSignal, number> = {
  rage_click: 40,
  dead_click: 30,
  failed_requests: 35,
  repeated_error: 35,
  js_error: 25,
  boundary: 60,
  stuck: 35,
  nav_loop: 35,
};

export const THRESHOLDS = {
  /** Score at which the nudge may fire. */
  fire: 60,
  /** The score loses half its value every this many ms. */
  halfLifeMs: 60_000,
  rageClicks: 3,
  rageWindowMs: 1_200,
  rageRadiusPx: 40,
  deadClicks: 3,
  deadWindowMs: 30_000,
  failedRequests: 2,
  failedWindowMs: 60_000,
  repeatedErrors: 2,
  repeatedErrorWindowMs: 60_000,
  stuckMs: 90_000,
  navLoopWindowMs: 45_000,
  /** Same signal can't re-trip within this time, so one burst isn't counted five times. */
  signalCooldownMs: 10_000,
} as const;

export type StruggleEvent = { signal: StruggleSignal; at: number };

export class StruggleDetector {
  private score = 0;
  private scoreAt = 0;
  private fired: StruggleEvent[] = [];
  private lastTrip = new Map<StruggleSignal, number>();
  private clicks: { t: number; x: number; y: number }[] = [];
  private deadClicks: number[] = [];
  private failures: number[] = [];
  private errorTexts = new Map<string, number[]>();
  private path: { p: string; t: number }[] = [];
  private stuckSince: number | null = null;

  /** Current score with decay applied. */
  getScore(now: number): number {
    if (this.score <= 0) return 0;
    const dt = Math.max(0, now - this.scoreAt);
    return this.score * Math.pow(0.5, dt / THRESHOLDS.halfLifeMs);
  }

  /** Distinct signals that have tripped this session, in order (for the "what we send" line). */
  signals(): StruggleSignal[] {
    return [...new Set(this.fired.map((e) => e.signal))];
  }

  isOverThreshold(now: number): boolean {
    return this.getScore(now) >= THRESHOLDS.fire;
  }

  /** After the nudge is shown, start from zero so one episode doesn't re-fire it. */
  reset(): void {
    this.score = 0;
    this.clicks = [];
    this.deadClicks = [];
    this.failures = [];
    this.errorTexts.clear();
  }

  private trip(signal: StruggleSignal, now: number): boolean {
    const last = this.lastTrip.get(signal);
    if (last !== undefined && now - last < THRESHOLDS.signalCooldownMs) return false;
    this.lastTrip.set(signal, now);
    this.score = this.getScore(now) + SIGNAL_WEIGHTS[signal];
    this.scoreAt = now;
    this.fired.push({ signal, at: now });
    return true;
  }

  /** Any click anywhere. Three within ~1.2s inside a small area is a rage click. */
  recordClick(now: number, x: number, y: number): boolean {
    this.clicks = this.clicks.filter((c) => now - c.t <= THRESHOLDS.rageWindowMs);
    this.clicks.push({ t: now, x, y });
    const near = this.clicks.filter(
      (c) => Math.hypot(c.x - x, c.y - y) <= THRESHOLDS.rageRadiusPx,
    );
    if (near.length >= THRESHOLDS.rageClicks) {
      this.clicks = [];
      return this.trip("rage_click", now);
    }
    return false;
  }

  /** A click on a non-interactive thing that caused no page change. 3 within 30s trips. */
  recordDeadClick(now: number): boolean {
    this.deadClicks = this.deadClicks.filter((t) => now - t <= THRESHOLDS.deadWindowMs);
    this.deadClicks.push(now);
    if (this.deadClicks.length >= THRESHOLDS.deadClicks) {
      this.deadClicks = [];
      return this.trip("dead_click", now);
    }
    return false;
  }

  /** One of our own requests failed (4xx/5xx or network error). 2 within a minute trips. */
  recordFailedRequest(now: number): boolean {
    this.failures = this.failures.filter((t) => now - t <= THRESHOLDS.failedWindowMs);
    this.failures.push(now);
    if (this.failures.length >= THRESHOLDS.failedRequests) {
      this.failures = [];
      return this.trip("failed_requests", now);
    }
    return false;
  }

  /** A validation/error message appeared. The same message twice within a minute trips. */
  recordErrorMessage(now: number, text: string): boolean {
    // Digits normalised so "Try again in 4s" and "in 3s" count as the same message.
    const key = text.trim().toLowerCase().replace(/\d+/g, "#").slice(0, 120);
    if (!key) return false;
    const times = (this.errorTexts.get(key) ?? []).filter(
      (t) => now - t <= THRESHOLDS.repeatedErrorWindowMs,
    );
    times.push(now);
    this.errorTexts.set(key, times);
    if (times.length >= THRESHOLDS.repeatedErrors) {
      this.errorTexts.delete(key);
      return this.trip("repeated_error", now);
    }
    return false;
  }

  /** Unhandled error / rejection. */
  recordJsError(now: number): boolean {
    return this.trip("js_error", now);
  }

  /** A React error boundary caught something: strongest single signal. */
  recordBoundary(now: number): boolean {
    return this.trip("boundary", now);
  }

  /** Page path changed. A→B→A→B within 45s trips; also resets "stuck". */
  recordNavigation(now: number, path: string): boolean {
    this.stuckSince = null;
    const last = this.path[this.path.length - 1];
    if (last && last.p === path) return false;
    this.path.push({ p: path, t: now });
    if (this.path.length > 4) this.path.shift();
    const [a, b, c, d] = this.path;
    if (
      this.path.length === 4 &&
      a.p === c.p &&
      b.p === d.p &&
      a.p !== b.p &&
      d.t - a.t <= THRESHOLDS.navLoopWindowMs
    ) {
      this.path = [this.path[3]];
      return this.trip("nav_loop", now);
    }
    return false;
  }

  /**
   * Call periodically. `waiting` is true while the user is on a step that should be
   * moving along (onboarding, guided step, something marked busy). After 90s of that
   * with no progress it trips once; call `recordProgress` when they move on.
   */
  tickStuck(now: number, waiting: boolean): boolean {
    if (!waiting) {
      this.stuckSince = null;
      return false;
    }
    if (this.stuckSince === null) this.stuckSince = now;
    if (now - this.stuckSince >= THRESHOLDS.stuckMs) {
      this.stuckSince = now;
      return this.trip("stuck", now);
    }
    return false;
  }

  recordProgress(): void {
    this.stuckSince = null;
  }
}
