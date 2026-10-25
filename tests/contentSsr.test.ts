// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const types = [{ id: "ct1", slug: "videos" }, { id: "ct2", slug: "happenings" }, { id: "ct3", slug: "stories" }];
const entries: Record<string, unknown[]> = {
  ct1: [
    { status: "PUBLISHED", createdAt: "2026-10-02T00:00:00Z", data: { title: "A Life <Well> Lived", description: "Lessons", video: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" } },
    { status: "DRAFT", createdAt: "2026-10-03T00:00:00Z", data: { title: "Hidden draft" } },
  ],
  ct2: [
    { status: "PUBLISHED", createdAt: "2026-10-01T00:00:00Z", data: { title: "Old gathering", date: "2001-01-01T10:00" } },
    { status: "PUBLISHED", createdAt: "2026-10-01T00:00:00Z", data: { title: "Storytelling Night", date: "2099-11-14T18:30", location: "Town Hall", description: "Come listen." } },
  ],
  ct3: [],
};
vi.mock("@/lib/db/customContentEntities", () => ({
  CustomContentType: { query: { primary: () => ({ go: async () => ({ data: types }) }) } },
  CustomContentEntry: { query: { primary: ({ contentTypeId }: { contentTypeId: string }) => ({ go: async () => ({ data: entries[contentTypeId] }) }) } },
}));

const blogItems = [
  { id: "a-post", title: "The Power of Listening", description: "", image: "https://img.example/a.jpg", imageAlt: "An open book", link: "/blog/a-post", dateLabel: "Oct 10, 2026" },
  { id: "b-post", title: "Wisdom <in> the Everyday", description: "", image: "", imageAlt: "", link: "/blog/b-post", dateLabel: "Oct 3, 2026" },
];
vi.mock("@/lib/customContent/blogSource", () => ({ BLOG_SLUG: "blog", listBlogItems: async () => blogItems }));

import { renderContentBlocks } from "@/lib/customContent/render";

const widgetJs = readFileSync("public/plexo-content.js", "utf8");
const marker = (slug: string, layout: string, extra = "") => `<div data-plexo-content="${slug}" data-plexo-content-layout="${layout}"${extra}></div>`;
const page = (body: string) => `<html><head><title>t</title></head><body>${body}</body></html>`;

describe("server-rendered content (what search engines read)", () => {
  it("puts published titles, descriptions and alt text in the HTML, escaped, and skips drafts", async () => {
    const out = await renderContentBlocks(page(marker("videos", "gallery")), "tpl", "https://example.com");
    expect(out).toContain("A Life &lt;Well&gt; Lived");
    expect(out).toContain("Lessons");
    expect(out).toContain('alt="A Life &lt;Well&gt; Lived"');
    expect(out).not.toContain("Hidden draft");
    expect(out).toContain('data-plexo-content-ssr="1"');
    expect(out).toContain("plexo-content.css");
  });

  it("adds schema.org VideoObject and Event data", async () => {
    const out = await renderContentBlocks(page(marker("videos", "gallery") + marker("happenings", "events")), "tpl", "https://example.com");
    const blocks = [...out.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
    const flat = blocks.flat();
    expect(flat.find((b) => b["@type"] === "VideoObject")).toMatchObject({ name: "A Life <Well> Lived", embedUrl: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" });
    expect(flat.find((b) => b["@type"] === "Event")).toMatchObject({ name: "Storytelling Night", startDate: "2099-11-14T18:30", location: { name: "Town Hall" } });
  });

  it("events: past ones are left out", async () => {
    const out = await renderContentBlocks(page(marker("happenings", "events")), "tpl", "https://example.com");
    expect(out).toContain("Storytelling Night");
    expect(out).not.toContain("Old gathering");
    expect(out).toContain("Saturday, November 14, 2099");
    expect(out).toContain("6:30 PM");
  });

  it("shows a friendly empty state when there is nothing yet, and for unknown content", async () => {
    const out = await renderContentBlocks(page(marker("stories", "stories") + marker("nope", "list")), "tpl", "https://example.com");
    expect(out).toContain("No stories yet. They'll appear here as soon as they're shared.");
    expect(out).toContain("Nothing here yet. It will appear here as soon as it's added.");
  });

  it("shows the site's latest blog posts as linked cards that update themselves", async () => {
    const out = await renderContentBlocks(page(marker("blog", "posts", ' data-plexo-content-limit="3"')), "tpl", "https://example.com");
    expect(out).toContain('<a class="plx-c-card plx-c-post" href="/blog/a-post">');
    expect(out).toContain('alt="An open book"');
    expect(out).toContain("Oct 10, 2026");
    expect(out).toContain("Wisdom &lt;in&gt; the Everyday");
    expect(out).not.toContain("<script type=\"application/ld+json\">[{\"@context\":\"https://schema.org\",\"@type\":\"VideoObject\"");
  });

  it("an empty section says what it is and when it fills (videos, blog)", async () => {
    const out = await renderContentBlocks(page(marker("more-videos", "featured")), "tpl", "https://example.com");
    expect(out).toContain("No videos yet. They'll appear here as soon as they're added.");
  });

  it("leaves pages without markers, and non-empty (editor placeholder) markers, alone", async () => {
    const plain = page("<p>hi</p>");
    expect(await renderContentBlocks(plain, "tpl", "https://x.com")).toBe(plain);
    const filled = page('<div data-plexo-content="videos">already here</div>');
    expect(await renderContentBlocks(filled, "tpl", "https://x.com")).toBe(filled);
  });

  describe("matches what the browser script draws (so the swap is invisible)", () => {
    const added: Array<[string, EventListenerOrEventListenerObject]> = [];
    const realAdd = document.addEventListener.bind(document);
    beforeEach(() => { document.addEventListener = ((t: string, l: EventListenerOrEventListenerObject) => { added.push([t, l]); realAdd(t, l); }) as typeof document.addEventListener; });
    afterEach(() => { for (const [t, l] of added.splice(0)) document.removeEventListener(t, l); });

    it.each([["gallery"], ["featured"], ["list"]])("%s", async (layout) => {
      const entry = (entries.ct1[0] as { data: unknown }).data;
      vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ entries: [entry] }) })));
      const ssr = await renderContentBlocks(page(marker("videos", layout)), "tpl", "https://example.com");
      document.body.innerHTML = /<body>([\s\S]*?)<script type="application/.exec(ssr)![1];
      const root = document.querySelector("[data-plexo-content]")!;
      const before = root.innerHTML;
      (window as any).__plexoContentLoaded = false;
      window.eval(widgetJs);
      await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0));
      expect(root.innerHTML).toBe(before);
    });
  });
});
