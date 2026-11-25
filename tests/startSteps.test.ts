import { describe, expect, it } from "vitest";
import { computeStartSteps, EDIT_LABEL_LIVE, EDIT_LABEL_NEW, type StartFacts } from "@/lib/dashboardV3/startSteps";

const base: StartFacts = { eligible: true, published: false, hasAddress: false, brandDone: false, edited: false, openedEditor: false, personalizedWithSol: false };
const run = (o: Partial<StartFacts> = {}) => computeStartSteps("s1", { ...base, ...o });

describe("start steps", () => {
  it("hides for a live site and for kinds that are not visual-editor sites", () => {
    expect(run({ published: true }).show).toBe(false);
    expect(run({ eligible: false }).show).toBe(false);
    expect(run({ published: true }).editLabel).toBe(EDIT_LABEL_LIVE);
  });
  it("a brand-new site has four ordered steps and Review is the one main button", () => {
    const r = run();
    expect(r.steps.map((s) => s.id)).toEqual(["review", "brand", "address", "publish"]);
    expect(r.primaryId).toBe("review");
    expect(r.steps.filter((s) => s.primary)).toHaveLength(1);
    expect(r.editLabel).toBe(EDIT_LABEL_NEW);
    expect(r.steps.find((s) => s.id === "publish")?.state).toBe("later");
  });
  it("the main button moves on after review: address, then publish", () => {
    expect(run({ openedEditor: true }).primaryId).toBe("address");
    expect(run({ edited: true }).editLabel).toBe(EDIT_LABEL_LIVE);
    const ready = run({ edited: true, hasAddress: true });
    expect(ready.primaryId).toBe("publish");
    expect(ready.steps.find((s) => s.id === "publish")?.state).toBe("next");
  });
  it("the logo step never blocks and ticks when the brand is set", () => {
    expect(run({ edited: true, hasAddress: true }).primaryId).toBe("publish");
    const r = run({ brandDone: true });
    expect(r.steps.find((s) => s.id === "brand")?.state).toBe("done");
    expect(r.doneCount).toBe(1);
  });
  it("a site SOL personalized has its review step ticked from the start, in the panel and on Home", () => {
    expect(run({ personalizedWithSol: true }).steps.find((s) => s.id === "review")?.state).toBe("done");
    expect(run({ personalizedWithSol: false }).steps.find((s) => s.id === "review")?.state).not.toBe("done");
  });
  it("links go to the existing tabs and the wording never says AI assistant", () => {
    const r = run({ personalizedWithSol: true });
    expect(r.steps.find((s) => s.id === "brand")?.href).toBe("/dashboard/sites/s1?tab=brand");
    expect(r.steps.find((s) => s.id === "address")?.href).toBe("/dashboard/sites/s1?tab=address");
    expect(JSON.stringify(r)).not.toMatch(/AI assistant|AI credits|Plexo's AI/i);
    expect(r.steps[0].body).toMatch(/SOL/);
  });
});
