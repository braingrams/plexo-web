import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/contentEntities", () => ({}));
vi.mock("@/lib/db/importEntities", () => ({}));
vi.mock("@/lib/db/commerceEntities", () => ({}));
vi.mock("@/lib/blog/savePostCore", () => ({}));
vi.mock("@/lib/blog/redirectsDynamo", () => ({}));
vi.mock("@/lib/blogImport/taxonomyDynamo", () => ({}));

vi.mock("@/lib/commerce/donations", () => ({}));
vi.mock("@/lib/wpMigration/storeImport", () => ({}));
vi.mock("@/lib/wpMigration/notify", () => ({}));
vi.mock("@/lib/wpMigration/captchaCarryOver", () => ({}));

import { isTransientAwsError, rewritePostLinks, stepErrorMessage } from "@/lib/wpMigration/runJobDynamo";

// What ElectroDB actually threw on maildrip.io's 542-post planning step.
const throttled = Object.assign(
  new Error('Error thrown by DynamoDB client: "Throughput exceeds the current capacity of your table or index. DynamoDB is automatically scaling your table or index so please try again shortly."'),
  { cause: { name: "ThrottlingException" } },
);

describe("migration step errors", () => {
  it("a DynamoDB throttle is temporary — retried, not shown to the owner", () => {
    expect(isTransientAwsError(throttled)).toBe(true);
    expect(isTransientAwsError({ name: "ProvisionedThroughputExceededException" })).toBe(true);
    expect(isTransientAwsError(new Error("WordPress returned 404"))).toBe(false);
  });

  it("the owner never reads a raw database error", () => {
    expect(stepErrorMessage("PLANNING", throttled)).toBe("Reading your WordPress site paused because Plexo was briefly busy saving your site.");
    expect(stepErrorMessage("POSTS", new Error("Error thrown by DynamoDB client: Item size has exceeded the maximum allowed size"))).toBe(
      "The posts step stopped because Plexo couldn't save part of your site.",
    );
    expect(stepErrorMessage("PAGES", new Error("Your WordPress site didn't respond"))).toBe("The pages step stopped: Your WordPress site didn't respond");
  });
});

describe("links to moved posts", () => {
  it("are rewritten in one pass, keeping anchors, whatever the trailing slash or encoding", () => {
    const moved = { "/2021/05/welcome": "/blog/welcome", "/café-tips": "/blog/cafe-tips" };
    const html = `<a href="/2021/05/welcome/">a</a> <a href='/2021/05/welcome#top'>b</a> <a href="/caf%C3%A9-tips/">c</a> <a href="/about/">d</a> <a href="https://x.org/2021/05/welcome/">e</a>`;
    expect(rewritePostLinks(html, moved)).toBe(
      `<a href="/blog/welcome">a</a> <a href='/blog/welcome#top'>b</a> <a href="/blog/cafe-tips">c</a> <a href="/about/">d</a> <a href="https://x.org/2021/05/welcome/">e</a>`,
    );
  });

  it("stays fast on a 9,000-post blog", () => {
    const moved = Object.fromEntries(Array.from({ length: 9000 }, (_, i) => [`/post-${i}`, `/blog/post-${i}`]));
    const html = Array.from({ length: 200 }, (_, i) => `<p><a href="/post-${i * 7}/">link</a></p>`).join("");
    const started = performance.now();
    const out = rewritePostLinks(html, moved);
    expect(performance.now() - started).toBeLessThan(50);
    expect(out).toContain('href="/blog/post-7"');
  });
});

describe("re-hosted post images", () => {
  it("each image gets its own file (the old key was the same for every image on a site)", async () => {
    const { mediaKey, isCollidedMapping } = await import("@/lib/blogImport/mediaRehostDynamo");
    const a = "https://maildrip.io/wp-content/uploads/2025/09/image-1-1024x468.png";
    const b = "https://maildrip.io/wp-content/uploads/2024/11/best-tools.png";
    expect(mediaKey("site", a, "png")).not.toBe(mediaKey("site", b, "png"));
    expect(mediaKey("site", a, "png")).toBe(mediaKey("site", a, "png"));
    // An old mapping is spotted so a re-run re-uploads it.
    expect(isCollidedMapping(a, "https://bucket/public/blog-import/site/aHR0cHM6Ly9tYWlsZHJpcC5pby93cC1jb250ZW50L3VwbG9h.png")).toBe(true);
    expect(isCollidedMapping(a, `https://bucket/public/${mediaKey("site", a, "png")}`)).toBe(false);
  });
});

describe("a WordPress firewall blocking the move", () => {
  it("is recognised from its block page, and the owner is told exactly what to do", async () => {
    const { firewallBlockOf, FirewallBlockedError } = await import("@/lib/wpMigration/http");
    // maildrip.io's real response once MalCare decided the migration was an attack.
    const malcare = `<div style='height: 98vh;'><div style='text-align: center; padding: 10% 0;'><div><p>MalCare Firewall</p></div><p>Blocked because of Malicious Activities</p><p>Reference ID: 15148550356ac698e2ab3e0</p></div></div>`;
    expect(firewallBlockOf(403, malcare)).toBe("MalCare");
    expect(firewallBlockOf(403, "<h1>Forbidden</h1>")).toBeNull(); // an ordinary 403 isn't a firewall
    expect(firewallBlockOf(200, malcare)).toBeNull();
    const message = stepErrorMessage("PAGES", new FirewallBlockedError("MalCare"));
    expect(message).toMatch(/MalCare firewall started blocking Plexo/);
    expect(message).toMatch(/allow Plexo or pause the firewall/);
    expect(message).toMatch(/Try again/);
  });
});
