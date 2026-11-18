import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// The /blog route handler self-fetches /_blog/... and relays the response. Next treats a
// folder named "_blog" as PRIVATE (never routed), so if the pages ever live under a plain
// "_blog" folder again, every blog URL on every published site silently 404s. The folder
// must be "%5Fblog" (Next's escape for a URL segment that starts with "_").
const pubDir = join(process.cwd(), "app", "pub", "[domain]");

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return pages(full);
    return name === "page.tsx" ? [full] : [];
  });
}

describe("published blog pages are routable", () => {
  it("has no private _blog folder", () => {
    expect(existsSync(join(pubDir, "_blog"))).toBe(false);
  });

  it("serves the blog index, posts, pagination, categories, tags and authors", () => {
    const dir = join(pubDir, "%5Fblog");
    const found = pages(dir).map((p) => p.slice(dir.length).replaceAll("\\", "/"));
    expect(found).toEqual(
      expect.arrayContaining([
        "/page.tsx",
        "/[...slug]/page.tsx",
        "/page/[pageNum]/page.tsx",
        "/category/[catSlug]/page.tsx",
        "/tag/[tagSlug]/page.tsx",
        "/author/[authorSlug]/page.tsx",
      ]),
    );
  });
});
