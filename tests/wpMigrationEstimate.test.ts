import { describe, expect, it } from "vitest";
import { estimateMigrationSeconds, estimateSecondsLeft, formatDuration } from "@/lib/wpMigration/estimate";

const counts = (over: Partial<Record<string, number>> = {}) => ({
  pages: 26, pagesDone: 0, pagesFailed: 0, posts: 9000, postsDone: 0, postsFailed: 0, assets: 30000, assetsDone: 0, assetsFailed: 0, assetsSkipped: 0, ...over,
});

describe("how long a migration takes", () => {
  it("before starting: a small site is minutes, a 9,000-post blog is hours", () => {
    expect(formatDuration(estimateMigrationSeconds({ pages: 11, posts: 2, media: 40 }))).toBe("about 4 minutes");
    expect(formatDuration(estimateMigrationSeconds({ pages: 26, posts: 542, media: 1022 }))).toMatch(/minutes$/);
    expect(formatDuration(estimateMigrationSeconds({ pages: 26, posts: 9000, media: 30000 }))).toMatch(/^about 6 hours$/);
  });

  it("while the site is still being read, it doesn't guess", () => {
    expect(estimateSecondsLeft({ phase: "PLANNING", counts: counts() })).toBeNull();
    expect(estimateSecondsLeft({ phase: "COMPLETED", counts: counts() })).toBeNull();
  });

  it("follows the site's real pace once there's enough progress", () => {
    const now = Date.parse("2026-10-07T12:00:00Z");
    const typical = estimateSecondsLeft({ phase: "POSTS", counts: counts({ postsDone: 1000 }), startedAt: new Date(now - 1245_000).toISOString(), now })!;
    const slowHost = estimateSecondsLeft({ phase: "POSTS", counts: counts({ postsDone: 1000 }), startedAt: new Date(now - 3 * 1245_000).toISOString(), now })!;
    expect(slowHost).toBeGreaterThan(typical * 2);
    // Fewer things left → less time left.
    expect(estimateSecondsLeft({ phase: "ASSETS", counts: counts({ postsDone: 9000, pagesDone: 26, assetsDone: 29000 }) })!).toBeLessThan(typical);
  });

  it("reads naturally", () => {
    expect(formatDuration(30)).toBe("about a minute");
    expect(formatDuration(7 * 60)).toBe("about 7 minutes");
    expect(formatDuration(23 * 60)).toBe("about 25 minutes");
    expect(formatDuration(65 * 60)).toBe("about an hour");
    expect(formatDuration(95 * 60)).toBe("about 1½ hours");
    expect(formatDuration(30 * 3600)).toBe("about 30 hours");
  });
});

describe("post SEO from any plugin", () => {
  it("reads Rank Math / AIOSEO / SEOPress tags from the published page", async () => {
    const { seoFromHtml } = await import("@/lib/wpMigration/inventory");
    const html = `<html><head><title>How To Build Your Personal Brand - MailDrip</title><meta name="description" content="Your personal brand matters."><meta name="robots" content="noindex, follow"><link rel="canonical" href="https://maildrip.io/brand/"><meta property="og:image" content="https://maildrip.io/a.webp"></head><body></body></html>`;
    expect(seoFromHtml(html)).toEqual({
      title: "How To Build Your Personal Brand - MailDrip",
      description: "Your personal brand matters.",
      canonical: "https://maildrip.io/brand/",
      robots: { index: "noindex", follow: "follow" },
      ogImage: "https://maildrip.io/a.webp",
    });
  });
});
