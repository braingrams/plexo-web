import { describe, expect, it } from "vitest";
import { computeTasks, EMPTY_FACTS, parsePriceToMinor, suggestAddressLabel, taskVariantFor, type SiteFacts } from "@/lib/dashboardV3/tasks";

const facts = (over: Partial<SiteFacts>): SiteFacts => ({ ...EMPTY_FACTS, ...over });

describe("computeTasks", () => {
  it("a brand-new store has the design done and the logo step next", () => {
    const p = computeTasks("store", facts({ hasSite: true }));
    expect(p.tasks.map((t) => t.state)).toEqual(["done", "current", "upcoming", "upcoming", "upcoming"]);
    expect(p.currentId).toBe("brand");
    expect(p.done).toBe(1);
  });

  it("ticks steps from real data, never from a stored flag", () => {
    const p = computeTasks("store", facts({ hasSite: true, hasLogo: true, hasColors: true, productCount: 2 }));
    expect(p.currentId).toBe("pay");
    expect(p.done).toBe(3);
  });

  it("the current step is the first open one even if a later one is already done", () => {
    const p = computeTasks("store", facts({ hasSite: true, hasLogo: true, hasColors: true, paymentsReady: true }));
    expect(p.currentId).toBe("product");
    expect(p.tasks.find((t) => t.id === "pay")?.state).toBe("done");
  });

  it("choosing the address and going online are ONE step, not two that repeat each other", () => {
    const base = facts({ hasSite: true, hasLogo: true, hasColors: true, productCount: 1, paymentsReady: true });
    const p = computeTasks("store", base);
    expect(p.currentId).toBe("finish");
    expect(p.hasAddress).toBe(false);
    expect(p.tasks.filter((t) => /address|online/i.test(t.title))).toHaveLength(0);
    expect(p.tasks.at(-1)).toMatchObject({ id: "finish", title: "Finish up", kind: "finish" });
  });

  it("finishing needs an address and a first publish", () => {
    const base = facts({ hasSite: true, hasLogo: true, hasColors: true, productCount: 1, paymentsReady: true });
    const half = computeTasks("store", { ...base, hasAddress: true });
    expect(half.currentId).toBe("finish");
    expect(half.hasAddress).toBe(true);
    const done = computeTasks("store", { ...base, hasAddress: true, published: true });
    expect(done.allDone).toBe(true);
    expect(done.currentId).toBeNull();
  });

  it("a published site with no address is not online yet", () => {
    expect(computeTasks("blog", facts({ hasSite: true, postCount: 1, published: true })).currentId).toBe("finish");
  });

  it("covers every variant with one finishing step (an app has its own: it is put online from its App tab)", () => {
    for (const v of ["store", "business", "blog", "course", "link", "app"] as const) {
      const p = computeTasks(v, EMPTY_FACTS);
      expect(p.tasks.at(-1)?.id).toBe(v === "app" ? "live" : "finish");
      expect(p.total).toBe(p.tasks.length);
    }
  });

  it("uses plain words only", () => {
    const banned = /template|deploy|dns|slug|subdomain|domain/i;
    for (const v of ["store", "business", "blog", "course", "link", "app"] as const) {
      for (const t of computeTasks(v, EMPTY_FACTS).tasks) expect(`${t.title} ${t.description} ${t.help}`).not.toMatch(banned);
    }
  });
});

describe("taskVariantFor", () => {
  it("trusts what the site is before what they once said they wanted", () => {
    expect(taskVariantFor({ kind: "Online store" }, "blog")).toBe("store");
    expect(taskVariantFor({ kind: "Website", sells: true }, null)).toBe("store");
    expect(taskVariantFor({ kind: "Course" }, "store")).toBe("course");
    expect(taskVariantFor({ kind: "App with sign-in" }, null)).toBe("app");
  });
  it("handles WordPress migrated sites taking payments without forcing a product step", () => {
    expect(taskVariantFor({ kind: "WordPress migrated site", sells: true, productCount: 0 }, null)).toBe("payments");
    expect(taskVariantFor({ kind: "WordPress migrated site", sells: true, productCount: 3 }, null)).toBe("store");
    expect(taskVariantFor({ kind: "WordPress migrated site", sells: false }, null)).toBe("business");
    expect(taskVariantFor({ kind: "Website", hasDonations: true, productCount: 0 }, null)).toBe("payments");
    expect(taskVariantFor({ kind: "Website", hasDonations: true, productCount: 2 }, null)).toBe("store");

    const p = computeTasks("payments", facts({ hasSite: true, hasLogo: true, hasColors: true, paymentsReady: true }));
    expect(p.tasks.map((t) => t.id)).toEqual(["design", "brand", "pay", "finish"]);
    expect(p.tasks.find((t) => t.id === "product")).toBeUndefined();
  });
  it("falls back to the goal, then to a business site", () => {
    expect(taskVariantFor({ kind: "Website" }, "link-in-bio")).toBe("link");
    expect(taskVariantFor({ kind: "Website" }, "landing")).toBe("business");
    expect(taskVariantFor({ kind: "Website" }, "explore")).toBe("business");
    expect(taskVariantFor({ kind: "Website" }, null)).toBe("business");
  });
});

describe("suggestAddressLabel", () => {
  it("turns a name into something that works in a web address", () => {
    expect(suggestAddressLabel("Ama's Kitchen")).toBe("amas-kitchen");
    expect(suggestAddressLabel("  Café  Déjà Vu!! ")).toBe("cafe-deja-vu");
    expect(suggestAddressLabel("")).toBe("my-site");
    expect(suggestAddressLabel("Jo")).toBe("jo-site");
  });
});

describe("parsePriceToMinor", () => {
  it("reads prices the way people type them", () => {
    expect(parsePriceToMinor("8,500")).toBe(850000);
    expect(parsePriceToMinor("₦ 8500.5")).toBe(850050);
    expect(parsePriceToMinor("abc")).toBeNull();
    expect(parsePriceToMinor("")).toBeNull();
  });
});
