import { describe, expect, it, vi } from "vitest";
import { EMPTY_DRAFT, canContinue, draftFromBuildProfile, draftToBuildProfile, goalMakesSite, resumeStep, waitingHint, GOALS, type OnboardingDraft } from "@/lib/onboarding/flow";
import { pickDesigns, rankDesigns, renderDesign, pageTypeForGoal } from "@/lib/onboarding/designs";
import { completeOnboarding, OnboardingError, siteCreateArgs, siteGoalFor } from "@/lib/onboarding/complete";
import { dominantColors } from "@/lib/onboarding/logoColors";

const draft = (over: Partial<OnboardingDraft> = {}): OnboardingDraft => ({ ...EMPTY_DRAFT, ...over });

describe("step logic", () => {
  it("needs a name, a goal and an experience before moving on; the look step is optional", () => {
    expect(canContinue(0, draft())).toBe(false);
    expect(canContinue(0, draft({ name: "  " }))).toBe(false);
    expect(canContinue(0, draft({ name: "Ama" }))).toBe(true);
    expect(canContinue(1, draft())).toBe(false);
    expect(canContinue(1, draft({ goal: "blog" }))).toBe(true);
    expect(canContinue(2, draft({ experience: "pro" }))).toBe(true);
    expect(canContinue(3, draft())).toBe(true);
    expect(waitingHint(0, draft())).toBe("Add a name to continue");
    expect(waitingHint(0, draft({ name: "A" }))).toBe("");
  });
  it("resumes on the first unanswered step", () => {
    expect(resumeStep(draft())).toBe(0);
    expect(resumeStep(draft({ name: "A" }))).toBe(1);
    expect(resumeStep(draft({ name: "A", goal: "store" }))).toBe(2);
    expect(resumeStep(draft({ name: "A", goal: "store", experience: "beginner" }))).toBe(3);
  });
  it("round-trips answers through the saved profile SOL reads", () => {
    const d = draft({ name: " Ama's  Kitchen ", about: "I sell meals", goal: "store", experience: "beginner", color: "#E4572E", feel: "warm", logoUrl: "https://x.test/l.png", suggested: ["#111111", "#E4572E"] });
    const p = draftToBuildProfile(d, "restaurant");
    expect(p).toEqual({ goal: "store", experience: "beginner", brand: { name: "Ama's Kitchen", about: "I sell meals", industry: "restaurant", tone: "warm & friendly", colors: ["#E4572E", "#111111"], logoUrl: "https://x.test/l.png" } });
    const back = draftFromBuildProfile(p);
    expect(back).toMatchObject({ name: "Ama's Kitchen", goal: "store", color: "#E4572E", feel: "warm", suggested: ["#111111"] });
  });
  it("ignores a logo that isn't an https address", () => {
    expect(draftToBuildProfile(draft({ name: "A", logoUrl: "blob:abc" })).brand?.logoUrl).toBeUndefined();
  });
  it("offers all eight goals; only an app skips the design step", () => {
    expect(GOALS).toHaveLength(8);
    expect(goalMakesSite("app")).toBe(false);
    expect(goalMakesSite("explore")).toBe(true);
  });
});

describe("design picking", () => {
  const store = { goal: "store" as const, brand: { name: "Ama's Kitchen", about: "I sell homemade meals", tone: "warm & friendly" } };
  it("chooses three distinct designs for a store, with the shop front first for a food business", () => {
    const { top, others } = pickDesigns(store);
    expect(top).toHaveLength(3);
    expect(new Set(top.map((d) => d.id)).size).toBe(3);
    expect(top[0].id).toBe("home-shop");
    expect(others.length).toBeGreaterThan(0);
    expect(rankDesigns(store)).toHaveLength(top.length + others.length);
  });
  it("uses one-page designs for a course, led by the course page", () => {
    expect(pageTypeForGoal("course")).toBe("landing");
    expect(pickDesigns({ goal: "course", brand: { name: "Learn" } }).top[0].id).toBe("landing-course");
  });
  it("renders a design with the owner's name, words and colour, and never says template", () => {
    const d = renderDesign({ ...store, brand: { ...store.brand, colors: ["#E4572E"] } }, "home-shop");
    expect(d?.html).toContain("Ama&#39;s Kitchen".replace("&#39;", "'")) ;
    expect(d?.html.toLowerCase()).toContain("e4572e");
    expect(JSON.stringify(pickDesigns(store)).toLowerCase()).not.toContain("template");
    expect(renderDesign(store, "no-such-design")).toBeNull();
  });
});

describe("what site_create gets", () => {
  const brand = { name: "Ama", about: "I sell meals" };
  it("maps each goal", () => {
    expect(siteGoalFor("store")).toBe("store");
    expect(siteGoalFor("explore")).toBe("business-site");
    expect(siteGoalFor("app")).toBeNull();
    const store = siteCreateArgs({ goal: "store", brand }, "home-shop") as { goal: string; pages: { type: string; layout?: string }[] };
    expect(store.goal).toBe("store");
    expect(store.pages.map((p) => p.type)).toEqual(["home", "store", "about", "faq", "contact"]);
    expect(store.pages[0].layout).toBe("home-shop");
    expect(store.pages[1].layout).toBeUndefined();
    const blog = siteCreateArgs({ goal: "blog", brand }, "home-classic") as { pages: { type: string }[] };
    expect(blog.pages.map((p) => p.type)).toContain("blog");
    const course = siteCreateArgs({ goal: "course", brand }, "landing-course") as { pages: { type: string; layout?: string }[] };
    expect(course.pages[0]).toEqual({ type: "landing", layout: "landing-course" });
    expect(siteCreateArgs({ goal: "app", brand }, "x")).toBeNull();
  });
  it("drops a design that doesn't belong to the goal instead of failing", () => {
    const args = siteCreateArgs({ goal: "store", brand }, "landing-course") as { pages: { layout?: string }[] };
    expect(args.pages[0].layout).toBeUndefined();
  });
});

describe("saving and creating", () => {
  const profile = { goal: "store", experience: "beginner", brand: { name: "Ama", about: "I sell homemade meals" } };
  const make = () => {
    const saves: Record<string, unknown>[] = [];
    return { saves, deps: { saveUser: vi.fn(async (p: Record<string, unknown>) => void saves.push(p)), createSite: vi.fn(async (_args: Record<string, unknown>) => ({ siteId: "s1", name: "Ama", warnings: ["w"] })) } };
  };
  it("saves the profile, builds the site, then marks onboarding done (last)", async () => {
    const { saves, deps } = make();
    const r = await completeOnboarding({ profile, designId: "home-shop" }, deps as never);
    expect(r.site).toEqual({ id: "s1", name: "Ama", goal: "store" });
    expect(saves[0]).toMatchObject({ experience: "beginner", buildProfile: { brand: { industry: expect.any(String) } } });
    expect(saves[0]).not.toHaveProperty("onboardingVersion");
    expect(saves[1]).toMatchObject({ onboardingVersion: 3 });
    expect(deps.createSite.mock.calls[0][0]).toMatchObject({ goal: "store", brief: { name: "Ama" } });
  });
  it("does not mark it done when the site can't be built, so they can retry", async () => {
    const { saves, deps } = make();
    deps.createSite.mockRejectedValueOnce(new Error("Your plan allows 1 site."));
    await expect(completeOnboarding({ profile, designId: "home-shop" }, deps as never)).rejects.toThrow("Your plan allows 1 site.");
    expect(saves.some((s) => "onboardingVersion" in s)).toBe(false);
  });
  it("builds from a real marketplace design instead of the recipe, named after the business", async () => {
    const { saves, deps } = make();
    const createFromMarketDesign = vi.fn(async (_id: string, _name: string) => ({ siteId: "m1", name: "Ama" }));
    const r = await completeOnboarding({ profile, marketDesignId: "tpl-9" }, { ...deps, createFromMarketDesign } as never);
    expect(createFromMarketDesign).toHaveBeenCalledWith("tpl-9", "Ama");
    expect(deps.createSite).not.toHaveBeenCalled();
    expect(r.site).toEqual({ id: "m1", name: "Ama", goal: "store" });
    expect(saves.at(-1)).toMatchObject({ onboardingVersion: 3 });
  });
  it("does not finish onboarding when a paid design is not bought yet", async () => {
    const { saves, deps } = make();
    const createFromMarketDesign = vi.fn(async () => { throw new Error("Buy this design first, then you can use it."); });
    await expect(completeOnboarding({ profile, marketDesignId: "tpl-9" }, { ...deps, createFromMarketDesign } as never)).rejects.toThrow("Buy this design first");
    expect(saves.some((s) => "onboardingVersion" in s)).toBe(false);
  });
  it("skipping (existing owners) and apps only personalise", async () => {
    for (const input of [{ profile, skipSite: true }, { profile: { ...profile, goal: "app" } }]) {
      const { saves, deps } = make();
      const r = await completeOnboarding(input, deps as never);
      expect(r.site).toBeNull();
      expect(deps.createSite).not.toHaveBeenCalled();
      expect(saves.at(-1)).toMatchObject({ onboardingVersion: 3 });
    }
  });
  it("asks for a name in plain words", async () => {
    const { deps } = make();
    await expect(completeOnboarding({ profile: { goal: "store" } }, deps as never)).rejects.toBeInstanceOf(OnboardingError);
  });
});

describe("logo colours", () => {
  const px = (r: number, g: number, b: number, a = 255, n = 50) => Array.from({ length: n }, () => [r, g, b, a]).flat();
  it("picks real colours, skips white, grey and see-through, and merges near-duplicates", () => {
    const data = [...px(255, 255, 255), ...px(120, 120, 120), ...px(228, 87, 46, 0), ...px(228, 87, 46, 255, 80), ...px(230, 90, 50, 255, 20), ...px(31, 111, 235)];
    expect(dominantColors(data)).toEqual(["#E4582F", "#1F6FEB"]);
  });
});
