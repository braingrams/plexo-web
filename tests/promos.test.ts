import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  choosePromo,
  PROMO_FEATURES, SEED_DEVELOPER_PROMO, SEED_PROMO, SEED_PROMOS, isDeveloper, isDismissed, pickPromo, promoClasses, promoHiddenOn, promoStatus, readDismissed,
  validatePromo, validatePromoHref, withDismissed, type PromoRecord,
} from "@/lib/promos/promos";

const NOW = Date.parse("2026-11-17T12:00:00Z");
const p = (o: Partial<PromoRecord>): PromoRecord => ({ ...SEED_PROMO, enabled: true, ...o });

describe("promo href rules", () => {
  it("accepts dashboard routes and https links", () => {
    for (const h of ["/dashboard/settings/moving", "/dashboard", "/dashboard/blog?x=1", "/dashboard/sol?new=1&draft=Hi%20there", "https://plexopages.com/learn"]) expect(validatePromoHref(h)).toBeNull();
  });
  it("rejects everything else", () => {
    for (const h of ["", "javascript:alert(1)", "data:text/html,x", "//evil.com", "http://x.com", "/admin", "/dashboardx", "/dashboard/../admin x", "ftp://a.b", "https://nodot", "/dashboard/a\\b"]) expect(validatePromoHref(h), h).not.toBeNull();
  });
});

describe("which promo shows", () => {
  it("picks the highest priority live one", () => {
    expect(pickPromo([p({ id: "b", priority: 20 }), p({ id: "a", priority: 5 })], {}, NOW)?.id).toBe("a");
  });
  it("skips off, scheduled, ended and invalid promos", () => {
    const list = [p({ id: "off", priority: 1, enabled: false }), p({ id: "soon", priority: 2, startsAt: "2026-12-01T00:00:00Z" }), p({ id: "gone", priority: 3, endsAt: "2026-11-01T00:00:00Z" }), p({ id: "bad", priority: 4, href: "javascript:x" }), p({ id: "ok", priority: 9 })];
    expect(pickPromo(list, {}, NOW)?.id).toBe("ok");
    expect(promoStatus(list[1], NOW)).toBe("scheduled");
    expect(promoStatus(list[2], NOW)).toBe("ended");
  });
  it("falls through to the next promo when one is dismissed, and re-shows after an edit bumps the version", () => {
    const list = [p({ id: "a", priority: 1, version: 1 }), p({ id: "b", priority: 2 })];
    expect(pickPromo(list, { a: 1 }, NOW)?.id).toBe("b");
    expect(pickPromo([p({ id: "a", priority: 1, version: 2 })], { a: 1 }, NOW)?.id).toBe("a");
    expect(isDismissed({ id: "a", version: 2 }, { a: 2 })).toBe(true);
    expect(pickPromo([list[0]], { a: 1 }, NOW)).toBeNull();
  });
  it("tracks dismissals safely", () => {
    expect(readDismissed("nope")).toEqual({});
    expect(readDismissed({ a: 1, b: "x" })).toEqual({ a: 1 });
    expect(withDismissed({ a: 3 }, "a", 1)).toEqual({ a: 3 });
    const big = withDismissed(Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`p${i}`, 1])), "new", 1);
    expect(Object.keys(big).length).toBe(30);
    expect(big.new).toBe(1);
  });
});

describe("where the strip stays out of the way", () => {
  it("hides in editors, SOL, onboarding, checkout and on its own target page", () => {
    for (const path of ["/dashboard/templates/abc", "/dashboard/apps/x", "/dashboard/sol", "/dashboard/sol/123", "/dashboard/onboarding", "/dashboard/settings/subscription", "/dashboard/new"]) expect(promoHiddenOn(path), path).toBe(true);
    expect(promoHiddenOn("/dashboard/settings/moving", "/dashboard/settings/moving")).toBe(true);
    for (const path of ["/dashboard", "/dashboard/sites", "/dashboard/commerce", "/dashboard/templates/upload"]) expect(promoHiddenOn(path, "/dashboard/blog"), path).toBe(false);
  });
});

describe("choosePromo (who sees the developer promo)", () => {
  const dev = { ...p({ id: "dev" }), audience: "developers" as const };
  it("a lone developer promo shows to a developer (it used to never show)", async () => {
    expect((await choosePromo([dev], {}, NOW, async () => true))?.id).toBe("dev");
  });
  it("and not to someone who isn't one", async () => {
    expect(await choosePromo([dev], {}, NOW, async () => false)).toBeNull();
  });
  it("a promo for everyone wins without asking who is a developer", async () => {
    let asked = false;
    const got = await choosePromo([dev, p({ id: "all", priority: 500 })], {}, NOW, async () => { asked = true; return true; });
    expect(got?.id).toBe("all");
    expect(asked).toBe(false);
  });
  it("a non-developer still gets the promo for everyone when both exist", async () => {
    expect((await choosePromo([dev, p({ id: "all", priority: 500 })], {}, NOW, async () => false))?.id).toBe("all");
  });
});

describe("developer promo", () => {
  const dev = { ...SEED_DEVELOPER_PROMO, enabled: true };
  it("is valid and seeded off", () => {
    expect(SEED_DEVELOPER_PROMO.enabled).toBe(false);
    expect(validatePromo(SEED_DEVELOPER_PROMO)).toEqual([]);
    expect(SEED_PROMOS.map((x) => x.id)).toEqual([SEED_PROMO.id, SEED_DEVELOPER_PROMO.id]);
  });
  it("shows only to developers, and promos for everyone come first", () => {
    expect(pickPromo([dev], {}, NOW)).toBeNull();
    expect(pickPromo([dev], {}, NOW, { developer: true })?.id).toBe(dev.id);
    expect(pickPromo([dev, p({ id: "all", priority: 500 })], {}, NOW, { developer: true })?.id).toBe("all");
  });
  it("once closed never comes back, even after the wording changes", () => {
    const closed = { [dev.id]: 1 };
    expect(pickPromo([{ ...dev, version: 7 }], closed, NOW, { developer: true })).toBeNull();
  });
  it("who counts as a developer", () => {
    expect(isDeveloper({ experience: "pro" })).toBe(true);
    expect(isDeveloper({ experience: "beginner", apiKeyCount: 1 })).toBe(true);
    expect(isDeveloper({ experience: "beginner" })).toBe(false);
  });
});

describe("seed and presets", () => {
  it("the seed is off, valid, and matches the WordPress preset", () => {
    expect(SEED_PROMO.enabled).toBe(false);
    expect(validatePromo(SEED_PROMO)).toEqual([]);
    const move = PROMO_FEATURES.find((f) => f.id === "move")!;
    expect([move.headline, move.body, move.buttonLabel, move.href]).toEqual([SEED_PROMO.headline, SEED_PROMO.body, SEED_PROMO.buttonLabel, SEED_PROMO.href]);
  });
  it("every preset link is valid and no icon is the sparkle", () => {
    for (const f of PROMO_FEATURES) { expect(validatePromoHref(f.href), f.id).toBeNull(); expect(f.icon).not.toMatch(/sparkle/i); }
  });
  it("validates wording, dates and images", () => {
    expect(validatePromo(p({ headline: " " })).length).toBe(1);
    expect(validatePromo(p({ startsAt: "2026-12-02T00:00:00Z", endsAt: "2026-12-01T00:00:00Z" })).length).toBe(1);
    expect(validatePromo(p({ imageUrl: "javascript:x" })).length).toBe(1);
  });
});

describe("strip styling contract (plexo-admin's preview copies these class names)", () => {
  it("has CSS for every class the markup uses, with tokens only", () => {
    const css = readFileSync("app/dashboard/_v3/v3.css", "utf8");
    for (const tone of ["light", "dark", "brand"] as const) {
      for (const cls of promoClasses(tone, true).split(" ")) expect(css, cls).toContain(cls === "plx-promo--light" ? ".plx-promo {" : `.${cls}`);
    }
    for (const cls of ["plx-promo__icon", "plx-promo__text", "plx-promo__title", "plx-promo__tag", "plx-promo__line", "plx-promo__btn", "plx-promo__close"]) expect(css).toContain(`.${cls}`);
  });
});
