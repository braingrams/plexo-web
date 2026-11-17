import { describe, expect, it } from "vitest";
import { computeTasks, isPublished, taskVariantFor, EMPTY_FACTS } from "@/lib/dashboardV3/tasks";

describe("has it been put online", () => {
  it("counts a site's active version and an app's live build", () => {
    expect(isPublished({ activeVersionId: "v1" })).toBe(true);
    expect(isPublished({ liveBuildId: "b1" })).toBe(true);
    expect(isPublished({ activeVersionId: null, liveBuildId: null })).toBe(false);
    expect(isPublished(null)).toBe(false);
  });

  it("an app that is live on its own domain no longer asks to be put online", () => {
    const variant = taskVariantFor({ kind: "App with sign-in", sells: false }, undefined);
    const facts = { ...EMPTY_FACTS, hasSite: true, hasAddress: true, published: isPublished({ liveBuildId: "b1" }) };
    const base = { ...facts, edited: true, signInOn: true };
    const before = computeTasks(variant, { ...base, published: false });
    expect(before.tasks.find((t) => t.id === "live")?.state).toBe("current");
    const after = computeTasks(variant, base);
    expect(after.tasks.find((t) => t.id === "live")?.state).toBe("done");
  });

  it("an uploaded page on its own address needs no logo step and is already online", () => {
    const variant = taskVariantFor({ kind: "Uploaded page", sells: false }, undefined);
    const p = computeTasks(variant, { ...EMPTY_FACTS, hasSite: true, hasAddress: true, edited: true, ownDesign: true, published: true });
    expect(p.tasks.filter((t) => t.state !== "done")).toEqual([]);
  });

  it("any site that is already live counts its look as chosen", () => {
    const variant = taskVariantFor({ kind: "Website", sells: false }, undefined);
    const p = computeTasks(variant, { ...EMPTY_FACTS, hasSite: true, hasAddress: true, published: true });
    expect(p.tasks.find((t) => t.id === "brand")?.state).toBe("done");
  });
});
