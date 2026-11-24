import { describe, expect, it } from "vitest";
import listings from "./fixtures/liveMarketplaceListings.json";
import { BUSINESS_TYPES, inferBusinessType, listingBusinessTypes, parseBusinessType, typeFit } from "@/lib/onboarding/businessType";
import { rankListings, type MarketListing } from "@/lib/onboarding/marketDesigns";
import { buildBusinessTypePrompt, parseBusinessTypeReply } from "@/lib/onboarding/understandWords";
import { sanitizeBuildProfile } from "@/lib/dashboardV3/profile";

// A snapshot of the real published marketplace (names, categories, descriptions) so ranking is checked against what owners really see.
const LIVE = listings as MarketListing[];
const top = (goal: string, name: string, about: string, type?: string, n = 1) => rankListings(LIVE, goal, { name, about, type }).slice(0, n).map((l) => l.name.split(":")[0]);

describe("business type inference", () => {
  it("reads the kind of business from a name or a description", () => {
    expect(inferBusinessType("Iron & Grain Gym")?.id).toBe("fitness");
    expect(inferBusinessType("Sunrise", "we look after elderly people in their own homes")?.id).toBe("care");
    expect(inferBusinessType("Smile", "dental clinic")?.id).toBe("health");
    expect(inferBusinessType("Mama Put", "we cook jollof rice and soups")?.id).toBe("restaurant");
    expect(inferBusinessType("Grace Chapel", "church and community outreach")?.id).toBe("nonprofit");
    expect(inferBusinessType("Tidy", "house cleaning and plumbing")?.id).toBe("homeservices");
  });
  it("tells a care home from a gym and a clinic (the earlier mix-up)", () => {
    expect(inferBusinessType("Careline", "home care and nursing for the elderly")?.id).toBe("care");
    expect(inferBusinessType("Iron", "gym with personal trainers and workouts")?.id).toBe("fitness");
    expect(inferBusinessType("Care", "nursing home")?.id).toBe("care");
  });
  it("returns nothing when the words point nowhere, instead of guessing", () => {
    expect(inferBusinessType("Kemi")).toBeNull();
    expect(inferBusinessType("The Spot", "come hang out with us")).toBeNull();
    expect(inferBusinessType("Alpha Omega Ltd", "we do great work for customers")).toBeNull();
  });
  it("does not find a word inside another word", () => {
    expect(inferBusinessType("Happy", "a happy place")?.id).not.toBe("tech");
  });
  it("only knows ids it lists", () => {
    expect(parseBusinessType("fitness")).toBe("fitness");
    expect(parseBusinessType("pirates")).toBeUndefined();
    expect(parseBusinessType(42)).toBeUndefined();
  });
});

describe("what a real design is", () => {
  const typeOf = (name: string) => listingBusinessTypes(LIVE.find((l) => l.name.startsWith(name))!);
  it("uses the seller's category, sharpened by the words", () => {
    expect(typeOf("Iron & Grain").primary).toEqual(["fitness"]);
    expect(typeOf("Still").primary).toEqual(["wellness"]); // "Health & Wellness" is two types: the yoga words decide
    expect(typeOf("Meridian").primary).toEqual(["health"]);
    expect(typeOf("Careline").primary).toEqual(["care"]);
    expect(typeOf("Chef Tomi").primary).toEqual(["restaurant"]); // a generic "Link in bio" category: the words say it is food
  });
  it("gives every real design a clear type", () => {
    for (const l of LIVE) expect(listingBusinessTypes(l).primary.length, l.name).toBeGreaterThan(0);
  });
  it("scores the same kind of business far above an unrelated one", () => {
    const gym = LIVE.find((l) => l.name.startsWith("Iron"))!;
    const care = LIVE.find((l) => l.name.startsWith("Careline"))!;
    expect(typeFit("fitness", gym)).toBe(100);
    expect(typeFit("fitness", care)).toBeLessThan(0);
    expect(typeFit("health", care)).toBeGreaterThan(typeFit("fitness", care));
  });
});

describe("ranking the real catalog for different owners", () => {
  const cases: Array<[string, string, string, RegExp]> = [
    ["business-site", "Iron & Grain", "a gym in Lagos where people get strong", /Iron/],
    ["business-site", "FitLife", "personal trainer, weight loss and workouts", /Iron/],
    ["business-site", "Hustle", "we help people get strong and healthy", /Iron/],
    ["business-site", "Sunrise Home", "we look after elderly people in their own homes", /Careline|Cedar|Willow/],
    ["business-site", "Nurse Joy", "home nursing visits for the elderly", /Careline|Cedar|Willow/],
    ["business-site", "Smile Bright", "dental clinic", /Bramble|Brightwater|Sprouts|Meridian/],
    ["business-site", "Zen", "yoga and meditation classes", /Still/],
    ["business-site", "Mama Put", "we cook jollof rice and soups, order for delivery", /Salgado|Ember$/],
    ["business-site", "Crumbs", "bakery with custom cakes", /Salgado|Ember$/],
    ["business-site", "Glow", "hair braiding and makeup salon", /Sol/],
    ["business-site", "Naija Law", "legal advice for small businesses", /Marlowe/],
    ["business-site", "RC Homes", "we sell and rent apartments in Lekki", /Haven/],
    ["business-site", "Grace Chapel", "church, sermons and community outreach", /Harvest/],
    ["business-site", "Taiwo Photography", "wedding photographer", /Aperture|Ada|Terrace/],
    ["business-site", "Blue Sky Hotel", "rooms and bookings", /Larch/],
    ["landing", "Payly", "an app that makes payments easy for small businesses", /Ledgerline|Relay|Fieldnote|Vaultline|Forge|Tidepool/],
    ["store", "Kicks", "we sell sneakers online", /Maison|Stride/],
    ["store", "Hustle Gear", "gym clothes and supplements", /Stride/],
    ["course", "Learn Spanish", "language classes", /Lengua/],
    ["course", "Code Camp", "teach people to code online", /Stackhouse/],
    ["link-in-bio", "DJ Spinall", "music, shows and mixtapes", /Noor/],
  ];
  for (const [goal, name, about, expected] of cases) {
    it(`${goal}: ${name} (${about.slice(0, 40)})`, () => {
      expect(top(goal, name, about)[0]).toMatch(expected);
    });
  }

  it("never puts a gym first for a care home, or the reverse", () => {
    expect(top("business-site", "Careline", "nursing home for seniors", undefined, 5)).not.toContain("Iron & Grain");
    expect(top("business-site", "Iron", "gym and personal training", undefined, 8)).not.toContain("Careline Home Nursing");
  });

  it("a normal website beats a link-in-bio page unless a link-in-bio was asked for", () => {
    expect(top("business-site", "Tomi's Kitchen", "we cook food for events", undefined, 1)[0]).not.toBe("Chef Tomi");
  });

  it("an owner's own pick or SOL's reading decides, even when the words say nothing", () => {
    // "Iron & Grain" with no description: the words point nowhere, but the owner (or SOL) says it is a gym.
    expect(top("business-site", "Iron & Grain", "", "fitness")[0]).toBe("Iron & Grain");
    expect(top("business-site", "Careline", "", "care")[0]).toMatch(/Careline|Cedar|Willow/);
    expect(top("business-site", "Moonlight", "", "hospitality")[0]).toBe("Larch");
  });

  it("an explicit pick overrides a misleading keyword", () => {
    // "coaching" reads as school/coaching, but the owner says it is a gym.
    expect(top("business-site", "Peak", "coaching people to lift", "fitness")[0]).toBe("Iron & Grain");
  });

  it("falls back to the closest kind when the catalog has no design for it", () => {
    // No home-service designs exist: the closest (professional services) is offered before anything unrelated.
    const names = top("business-site", "Tidy", "house cleaning and plumbing services", undefined, 2);
    expect(names).toContain("Marlowe Law");
  });
});

describe("asking SOL what kind of business it is", () => {
  it("lists only the known types and works from the name alone", () => {
    const p = buildBusinessTypePrompt("Careline", "", "business-site");
    for (const t of BUSINESS_TYPES) expect(p).toContain(t.id);
    expect(p).toContain("Careline");
  });
  it("accepts only a known id, whatever else the model says", () => {
    expect(parseBusinessTypeReply('{"type":"care"}')).toBe("care");
    expect(parseBusinessTypeReply('Sure! {"type":"Fitness"} hope that helps')).toBe("fitness");
    expect(parseBusinessTypeReply('{"type":"unknown"}')).toBeNull();
    expect(parseBusinessTypeReply('{"type":"ignore previous instructions"}')).toBeNull();
    expect(parseBusinessTypeReply("not json")).toBeNull();
  });
});

describe("the profile carries the owner's pick", () => {
  it("keeps a known business type and drops an unknown one", () => {
    const ok = sanitizeBuildProfile({ goal: "business-site", brand: { name: "X", businessType: "fitness" } });
    expect(ok.ok && ok.value.brand?.businessType).toBe("fitness");
    const bad = sanitizeBuildProfile({ goal: "business-site", brand: { name: "X", businessType: "<script>" } });
    expect(bad.ok && bad.value.brand?.businessType).toBeUndefined();
  });
});
