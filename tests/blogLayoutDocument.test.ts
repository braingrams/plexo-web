import { describe, expect, it } from "vitest";
import { splitLayoutDocument } from "@/lib/pub/layoutDocument";
import { fillCardTemplate } from "@/lib/pub/blogLivePostLists";

describe("a blog layout that's a whole WordPress page", () => {
  it("keeps its <html>/<body> attributes for the real page instead of losing them", () => {
    const doc = `<!doctype html><html lang="en-US"><head><style>.elementor-kit-20{--c:#fff}</style></head><body class="blog elementor-kit-20" data-x='1'><h1>Muzingo Blog</h1></body></html>`;
    const parts = splitLayoutDocument(doc);
    expect(parts.bodyAttrs).toEqual({ class: "blog elementor-kit-20", "data-x": "1" });
    expect(parts.htmlAttrs).toEqual({ lang: "en-US" });
    expect(parts.content).toBe("<style>.elementor-kit-20{--c:#fff}</style><h1>Muzingo Blog</h1>");
    expect(parts.content).not.toMatch(/<body|<html|<head/);
  });

  it("passes a fragment through untouched", () => {
    expect(splitLayoutDocument("<section>hi</section>")).toEqual({ content: "<section>hi</section>", htmlAttrs: {}, bodyAttrs: {} });
  });
});

describe("a post card in the site's own design", () => {
  const post = {
    url: "/blog/p-square", title: "P-Square Songs", excerpt: "P-Square combined R&amp;B harmonies. From &#8220;Do Me&#8221; to &#8220;Personally&#8221; their discography remains the gold standard",
    imageUrl: "https://cdn/x.webp", imageAlt: null, authorName: null, authorUrl: null, categoryName: null, categoryUrl: null, readingMinutes: null, publishedAt: null,
  } as never;

  it("shows WordPress's encoded text as text", () => {
    const html = fillCardTemplate("<p>%%plexo.excerpt%%</p>", post);
    expect(html).toContain("R&amp;B harmonies");
    expect(html).toContain("“Do Me”");
    expect(html).not.toContain("&amp;#8220;");
  });

  it("keeps the card's image shape (WordPress served a cropped thumbnail)", () => {
    const html = fillCardTemplate(`<img width="412" height="274" src="%%plexo.image%%" alt="">`, post);
    expect(html).toContain('style="aspect-ratio:412 / 274;object-fit:cover;"');
  });

  it("cuts the excerpt to the words the site's cards showed — with an ellipsis only if they had one", () => {
    // Muzingo's Elementor cards: 15 words, no ellipsis ("…Start your Dolly" then "Read More").
    expect(fillCardTemplate("<p>%%plexo.excerpt:4%%</p>", post)).toBe("<p>P-Square combined R&amp;B harmonies.</p>");
    expect(fillCardTemplate("<p>%%plexo.excerpt:4…%%</p>", post)).toBe("<p>P-Square combined R&amp;B harmonies…</p>");
  });
});
