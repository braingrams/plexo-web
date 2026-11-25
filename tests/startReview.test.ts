import { describe, expect, it } from "vitest";
import { editedByOwner, reviewedByOwner, shouldWriteReviewFlag } from "@/lib/dashboardV3/startReview";
import { computeStartSteps, type StartFacts } from "@/lib/dashboardV3/startSteps";
import { computeTasks, EMPTY_FACTS } from "@/lib/dashboardV3/tasks";
import { SOL_INTRO_BODY, SOL_INTRO_HEADING, SOL_INTRO_PROMPTS, shouldShowSolIntro, solIntroHref } from "@/lib/dashboardV3/solIntro";

const T0 = "2026-01-01T10:00:00.000Z";
const at = (sec: number) => new Date(Date.parse(T0) + sec * 1000).toISOString();

describe("reviewed flag per site", () => {
  it("a fresh site is neither edited nor reviewed", () => {
    expect(editedByOwner({ createdAt: T0, updatedAt: at(5) })).toBe(false);
    expect(reviewedByOwner({ createdAt: T0, updatedAt: at(5) })).toBe(false);
  });
  it("opening the editor (the flag) counts as reviewed even though nothing was edited", () => {
    expect(reviewedByOwner({ createdAt: T0, updatedAt: at(5), startReviewedAt: at(5) })).toBe(true);
  });
  it("writing the flag later does not make the site look edited (it bumps updatedAt)", () => {
    const t = { createdAt: T0, updatedAt: at(600), startReviewedAt: at(600) };
    expect(editedByOwner(t)).toBe(false);
    expect(reviewedByOwner(t)).toBe(true);
  });
  it("a real edit after the flag is still an edit", () => {
    expect(editedByOwner({ createdAt: T0, updatedAt: at(900), startReviewedAt: at(600) })).toBe(true);
  });
  it("an edited site is reviewed and needs no flag write; an already-flagged one is left alone", () => {
    expect(reviewedByOwner({ createdAt: T0, updatedAt: at(600) })).toBe(true);
    expect(shouldWriteReviewFlag({ createdAt: T0, updatedAt: at(600) })).toBe(false);
    expect(shouldWriteReviewFlag({ createdAt: T0, updatedAt: at(10), startReviewedAt: at(10) })).toBe(false);
    expect(shouldWriteReviewFlag({ createdAt: T0, updatedAt: at(10) })).toBe(true);
    expect(shouldWriteReviewFlag(null)).toBe(false);
  });
  it("Home ticks 'Review and edit your pages' as soon as SOL has personalized the site", () => {
    const home = computeTasks("business", { ...EMPTY_FACTS, hasSite: true, personalizedWithSol: true });
    expect(home.tasks.find((x) => x.id === "words")!.state).toBe("done");
  });
  it("the hub panel and Home's checklist agree for the same site", () => {
    const sites = [
      { createdAt: T0, updatedAt: at(5) },
      { createdAt: T0, updatedAt: at(5), startReviewedAt: at(5) },
      { createdAt: T0, updatedAt: at(900) },
    ];
    for (const t of sites) {
      const panel: StartFacts = { eligible: true, published: false, hasAddress: false, brandDone: false, edited: editedByOwner(t), openedEditor: !!(t as { startReviewedAt?: string }).startReviewedAt, personalizedWithSol: true };
      const panelDone = computeStartSteps("s1", panel).steps.find((s) => s.id === "review")!.state === "done";
      const home = computeTasks("business", { ...EMPTY_FACTS, hasSite: true, personalizedWithSol: true, edited: editedByOwner(t), reviewed: reviewedByOwner(t) });
      expect(home.tasks.find((x) => x.id === "words")!.state === "done").toBe(panelDone);
    }
  });
});

describe("SOL's first hello", () => {
  it("speaks in the first person with three plain examples", () => {
    expect(SOL_INTRO_HEADING).toBe("Hi, I'm SOL.");
    expect(SOL_INTRO_BODY).toMatch(/^I can build and change your website for you/);
    expect(SOL_INTRO_PROMPTS).toHaveLength(3);
    for (const s of [SOL_INTRO_HEADING, SOL_INTRO_BODY, ...SOL_INTRO_PROMPTS]) expect(s).not.toMatch(/assistant|agent|\bbot\b|AI credits/i);
  });
  it("shows only when wanted, not seen in this browser, and the account says not seen", () => {
    expect(shouldShowSolIntro({ wanted: true, localSeen: false, serverSeen: false })).toBe(true);
    expect(shouldShowSolIntro({ wanted: true, localSeen: false, serverSeen: null })).toBe(false);
    expect(shouldShowSolIntro({ wanted: true, localSeen: true, serverSeen: false })).toBe(false);
    expect(shouldShowSolIntro({ wanted: true, localSeen: false, serverSeen: true })).toBe(false);
    expect(shouldShowSolIntro({ wanted: false, localSeen: false, serverSeen: false })).toBe(false);
  });
  it("an idea opens a fresh SOL chat with the words in the box", () => {
    expect(solIntroHref("Add a pricing page")).toBe("/dashboard/sol?new=1&draft=Add%20a%20pricing%20page");
  });
});
