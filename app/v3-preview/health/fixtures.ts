import { mockSpeed } from "@/lib/siteHealth/psi";
import { presentHealth } from "@/lib/siteHealth/present";
import type { AeoReport, HealthReport, HealthStatus, SpeedReport } from "@/lib/siteHealth/types";

/** DEV ONLY: made-up Site health results for the preview screens. They are run through the real wording code, so the screens say what real ones say. */

// (Not imported from serve.ts: that file reaches the database, which the preview must not need.)
const NO_SETTINGS: HealthStatus["settings"] = { extras: {}, fallbackDescription: null, llmsTxt: false, organizationSchema: false, lazyEmbeds: false, altFromFilename: false, language: null, business: null, aiTitles: {}, aiAlts: {}, emailDigest: true };

export type HealthScenario = "slow" | "fast";

const aeo = (score: number, failing: string[]): AeoReport => ({
  score,
  checks: ["structured_data", "headings", "meta_description", "llms_txt", "ai_crawlers", "sitemap", "alt_text", "title", "open_graph", "canonical", "language"].map((id, i) => ({ id: id as AeoReport["checks"][number]["id"], passed: !failing.includes(id), weight: 9, detail: `${i}` })),
});

const slowPhone = (): SpeedReport => ({
  ...mockSpeed(),
  speed: 34,
  seo: 91,
  accessibility: 83,
  bestPractices: 78,
  lcp: { value: 5.8, rating: "poor", source: "test" },
  cls: { value: 0.31, rating: "poor", source: "test" },
  fcp: { value: 3.2, rating: "poor", source: "test" },
  tbt: { value: 1240, rating: "poor", source: "test" },
  opportunities: [
    { id: "prioritize-lcp-image", savingsMs: 1800 },
    { id: "uses-optimized-images", savingsMs: 1200, savingsBytes: 980_000 },
    { id: "render-blocking-resources", savingsMs: 700 },
  ],
  failedAudits: ["prioritize-lcp-image", "uses-optimized-images", "unsized-images", "render-blocking-resources", "image-alt", "meta-description", "font-display"],
  elements: { "image-alt": [{ selector: "body > section.hero > img", snippet: '<img src="https://cdn.example/hero.jpg">', label: "Picture at the top of the page" }] },
});

const fastPhone = (): SpeedReport => ({
  ...mockSpeed(),
  speed: 97,
  seo: 100,
  accessibility: 95,
  bestPractices: 100,
  lcp: { value: 1.1, rating: "good", source: "visitors" },
  cls: { value: 0.01, rating: "good", source: "visitors" },
  fcp: { value: 0.7, rating: "good", source: "visitors" },
  tbt: { value: 30, rating: "good", source: "test" },
  inp: { value: 90, rating: "good", source: "visitors" },
  inpEstimated: false,
  fieldScope: "page",
  opportunities: [],
  failedAudits: [],
  elements: {},
  hasRealVisitorData: true,
});

export function healthStatus(scenario: HealthScenario): HealthStatus {
  const slow = scenario === "slow";
  const phone = slow ? slowPhone() : fastPhone();
  const computer: SpeedReport = slow ? { ...slowPhone(), speed: 61, lcp: { value: 2.9, rating: "okay", source: "test" }, cls: { value: 0.12, rating: "okay", source: "test" }, tbt: { value: 260, rating: "okay", source: "test" } } : { ...fastPhone(), speed: 100 };
  const report: HealthReport = {
    url: slow ? "https://mamatee.plexopages.io" : "https://amaskitchen.com",
    speed: phone,
    desktop: computer,
    aeo: slow ? aeo(54, ["structured_data", "meta_description", "llms_txt", "alt_text", "open_graph"]) : aeo(91, ["llms_txt"]),
  };
  const now = Date.now();
  const day = 86_400_000;
  return {
    siteId: slow ? "slow" : "fast",
    url: report.url,
    last: { createdAt: new Date(now - 2 * 3_600_000).toISOString(), report },
    history: slow
      ? [{ createdAt: new Date(now - 21 * day).toISOString(), speed: 52, aeo: 40, desktop: 70 }, { createdAt: new Date(now - 14 * day).toISOString(), speed: 47, aeo: 48, desktop: 66 }, { createdAt: new Date(now - 7 * day).toISOString(), speed: 41, aeo: 51, desktop: 63 }, { createdAt: new Date(now - 2 * 3_600_000).toISOString(), speed: 34, aeo: 54, desktop: 61 }]
      : [{ createdAt: new Date(now - 14 * day).toISOString(), speed: 93, aeo: 84, desktop: 98 }, { createdAt: new Date(now - 7 * day).toISOString(), speed: 95, aeo: 88, desktop: 99 }, { createdAt: new Date(now - 2 * 3_600_000).toISOString(), speed: 97, aeo: 91, desktop: 100 }],
    stale: false,
    fixesChangedSinceCheck: false,
    nextCheckAt: new Date(now + 4 * 60_000).toISOString(),
    settings: slow ? NO_SETTINGS : { ...NO_SETTINGS, llmsTxt: false, organizationSchema: true, fallbackDescription: "Fresh bread and pastries, baked every morning in Lagos.", extras: { image_sizes: true, fast_fonts: true, social_tags: true } },
    facts: { productCount: 0 },
    auto: { lastAt: null, nextAt: new Date(now + 5 * day).toISOString(), reason: "weekly" },
  };
}

/** What the screen receives from the health endpoint, in plain words. */
export function healthPayload(scenario: HealthScenario) {
  const status = healthStatus(scenario);
  return { ...presentHealth(status), available: true };
}
