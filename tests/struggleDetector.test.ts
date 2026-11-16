import { describe, expect, it } from "vitest";
import { StruggleDetector, THRESHOLDS } from "@/lib/struggle/detector";
import { canShowNudge, DAY_MS, isGuidedStepPath, isInteractiveTarget, isPaymentField, isTypingTarget, onPaymentPath, readMemory, writeMemory } from "@/lib/struggle/policy";

const T = 1_000_000;
const ok = { shownThisSession: false, typing: false, onPaymentField: false, modalOpen: false };

describe("signals", () => {
  it("rage click: 3 clicks within 1.2s in a small area", () => {
    const d = new StruggleDetector();
    expect(d.recordClick(T, 100, 100)).toBe(false);
    expect(d.recordClick(T + 300, 105, 98)).toBe(false);
    expect(d.recordClick(T + 600, 102, 101)).toBe(true);
    expect(d.signals()).toEqual(["rage_click"]);
  });
  it("rage click ignores slow or spread-out clicks", () => {
    const d = new StruggleDetector();
    d.recordClick(T, 100, 100); d.recordClick(T + 700, 100, 100);
    expect(d.recordClick(T + 1500, 100, 100)).toBe(false);
    const e = new StruggleDetector();
    e.recordClick(T, 0, 0); e.recordClick(T + 100, 300, 0);
    expect(e.recordClick(T + 200, 600, 0)).toBe(false);
  });
  it("dead clicks: 3 within 30s", () => {
    const d = new StruggleDetector();
    d.recordDeadClick(T); d.recordDeadClick(T + 5000);
    expect(d.recordDeadClick(T + 10_000)).toBe(true);
    const e = new StruggleDetector();
    e.recordDeadClick(T); e.recordDeadClick(T + 20_000);
    expect(e.recordDeadClick(T + 40_000)).toBe(false);
  });
  it("failed requests: 2 within a minute, not 2 spread over more", () => {
    const d = new StruggleDetector();
    d.recordFailedRequest(T);
    expect(d.recordFailedRequest(T + 30_000)).toBe(true);
    const e = new StruggleDetector();
    e.recordFailedRequest(T);
    expect(e.recordFailedRequest(T + 61_000)).toBe(false);
  });
  it("same error message twice (digits normalised), different messages do not", () => {
    const d = new StruggleDetector();
    d.recordErrorMessage(T, "Try again in 4s");
    expect(d.recordErrorMessage(T + 5000, "Try again in 3s")).toBe(true);
    const e = new StruggleDetector();
    e.recordErrorMessage(T, "Name is required");
    expect(e.recordErrorMessage(T + 1000, "Email is invalid")).toBe(false);
    expect(e.recordErrorMessage(T, "")).toBe(false);
  });
  it("js error and boundary", () => {
    const d = new StruggleDetector();
    expect(d.recordJsError(T)).toBe(true);
    expect(d.isOverThreshold(T)).toBe(false);
    expect(new StruggleDetector().recordBoundary(T)).toBe(true);
    const b = new StruggleDetector(); b.recordBoundary(T);
    expect(b.isOverThreshold(T)).toBe(true);
  });
  it("stuck after 90s of waiting, reset by progress/navigation", () => {
    const d = new StruggleDetector();
    expect(d.tickStuck(T, true)).toBe(false);
    expect(d.tickStuck(T + 89_000, true)).toBe(false);
    expect(d.tickStuck(T + 90_000, true)).toBe(true);
    const e = new StruggleDetector();
    e.tickStuck(T, true); e.recordNavigation(T + 60_000, "/dashboard/new");
    expect(e.tickStuck(T + 100_000, true)).toBe(false);
    e.tickStuck(T + 110_000, false);
    expect(e.tickStuck(T + 120_000, true)).toBe(false);
  });
  it("navigation loop A-B-A-B within 45s", () => {
    const d = new StruggleDetector();
    d.recordNavigation(T, "/a"); d.recordNavigation(T + 5000, "/b"); d.recordNavigation(T + 10_000, "/a");
    expect(d.recordNavigation(T + 15_000, "/b")).toBe(true);
    const e = new StruggleDetector();
    e.recordNavigation(T, "/a"); e.recordNavigation(T + 20_000, "/b"); e.recordNavigation(T + 40_000, "/a");
    expect(e.recordNavigation(T + 60_000, "/b")).toBe(false);
    const f = new StruggleDetector();
    f.recordNavigation(T, "/a"); f.recordNavigation(T + 1, "/b"); f.recordNavigation(T + 2, "/c");
    expect(f.recordNavigation(T + 3, "/b")).toBe(false);
  });
  it("a signal cannot re-trip inside its cooldown", () => {
    const d = new StruggleDetector();
    expect(d.recordJsError(T)).toBe(true);
    expect(d.recordJsError(T + 1000)).toBe(false);
    expect(d.recordJsError(T + THRESHOLDS.signalCooldownMs)).toBe(true);
  });
});

describe("score", () => {
  it("combines signals past the threshold; one rage click alone does not", () => {
    const d = new StruggleDetector();
    d.recordClick(T, 1, 1); d.recordClick(T + 1, 1, 1); d.recordClick(T + 2, 1, 1);
    expect(d.isOverThreshold(T + 3)).toBe(false);
    d.recordFailedRequest(T + 1000); d.recordFailedRequest(T + 2000);
    expect(d.isOverThreshold(T + 3000)).toBe(true);
  });
  it("decays: signals minutes apart do not add up", () => {
    const d = new StruggleDetector();
    d.recordBoundary(T);
    expect(d.getScore(T + THRESHOLDS.halfLifeMs)).toBeCloseTo(30, 0);
    expect(d.isOverThreshold(T + 2 * THRESHOLDS.halfLifeMs)).toBe(false);
    d.recordJsError(T + 5 * 60_000);
    expect(d.isOverThreshold(T + 5 * 60_000)).toBe(false);
  });
  it("reset clears the score but remembers the signals for the report", () => {
    const d = new StruggleDetector(); d.recordBoundary(T); d.reset();
    expect(d.getScore(T)).toBe(0);
    expect(d.signals()).toEqual(["boundary"]);
  });
});

describe("back-off and suppression", () => {
  it("allows when nothing blocks", () => expect(canShowNudge(T, {}, ok).ok).toBe(true));
  it("once per session", () => expect(canShowNudge(T, {}, { ...ok, shownThisSession: true })).toEqual({ ok: false, reason: "session" }));
  it("once per day per user", () => {
    expect(canShowNudge(T + DAY_MS - 1, { lastShownAt: T }, ok)).toEqual({ ok: false, reason: "daily" });
    expect(canShowNudge(T + DAY_MS, { lastShownAt: T }, ok).ok).toBe(true);
  });
  it("honours Don't show again", () => expect(canShowNudge(T + 10 * DAY_MS, { optedOut: true }, ok)).toEqual({ ok: false, reason: "opted_out" }));
  it("never while typing, on payment fields, or over a modal", () => {
    expect(canShowNudge(T, {}, { ...ok, typing: true })).toEqual({ ok: false, reason: "typing" });
    expect(canShowNudge(T, {}, { ...ok, onPaymentField: true })).toEqual({ ok: false, reason: "payment" });
    expect(canShowNudge(T, {}, { ...ok, modalOpen: true })).toEqual({ ok: false, reason: "modal" });
  });
  it("remembers per user in storage, tolerates broken storage", () => {
    const m = new Map<string, string>();
    const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    writeMemory("u1", { lastShownAt: T, optedOut: true }, store);
    expect(readMemory("u1", store)).toEqual({ lastShownAt: T, optedOut: true });
    expect(readMemory("u2", store)).toEqual({ lastShownAt: undefined, optedOut: false });
    expect(readMemory("u1", { getItem: () => { throw new Error("blocked"); } })).toEqual({});
  });
});

const el = (tag: string, attrs: Record<string, string> = {}, closestMatch = false) => ({
  tagName: tag, getAttribute: (n: string) => attrs[n] ?? null, closest: () => (closestMatch ? ({} as never) : null),
});
describe("dom helpers", () => {
  it("typing targets", () => {
    expect(isTypingTarget(el("TEXTAREA"))).toBe(true);
    expect(isTypingTarget(el("INPUT", { type: "email" }))).toBe(true);
    expect(isTypingTarget(el("INPUT", { type: "checkbox" }))).toBe(false);
    expect(isTypingTarget(el("BUTTON"))).toBe(false);
  });
  it("payment fields and paths", () => {
    expect(isPaymentField(el("INPUT", { autocomplete: "cc-number" }))).toBe(true);
    expect(isPaymentField(el("INPUT", { name: "cvc" }))).toBe(true);
    expect(isPaymentField(el("IFRAME"))).toBe(true);
    expect(isPaymentField(el("INPUT", { name: "title" }))).toBe(false);
    expect(onPaymentPath("/dashboard/settings/billing")).toBe(true);
    expect(onPaymentPath("/dashboard/pages")).toBe(false);
  });
  it("interactive vs not, guided paths", () => {
    expect(isInteractiveTarget(el("DIV", {}, true))).toBe(true);
    expect(isInteractiveTarget(el("DIV"))).toBe(false);
    expect(isGuidedStepPath("/dashboard/new")).toBe(true);
    expect(isGuidedStepPath("/dashboard/pages")).toBe(false);
  });
});
