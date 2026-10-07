import { describe, expect, it } from "vitest";
import { archiveMetadata, listingMetadata, postMetadata } from "@/lib/blog/seo";

// A customer's blog pages must never carry the dashboard's "%s | Plexo" title template.
describe("blog page titles belong to the customer's site", () => {
  it("listing: the WordPress posts page's own SEO title when migrated, else the blog's name", () => {
    expect(listingMetadata("maildrip.io", { title: "Blog", description: null, metaTitle: "Blog | Email Marketing Tips and Best Practices" }).title).toEqual({ absolute: "Blog | Email Marketing Tips and Best Practices" });
    expect(listingMetadata("x.org", { title: "News", description: null }).title).toEqual({ absolute: "News" });
  });

  it("archives and posts are absolute too", () => {
    expect(archiveMetadata("x.org", "News", "Tips", "/blog/category/tips").title).toEqual({ absolute: "Tips — News" });
    const post = { title: "Hello", slug: "hello", metaTitle: "Hello — Rank Math title", metaDescription: null, excerpt: null, contentHtml: "", ogImageUrl: null, featuredImageUrl: null, noindex: false, publishedAt: null, updatedAt: null, author: null } as never;
    expect(postMetadata("x.org", post).title).toEqual({ absolute: "Hello — Rank Math title" });
  });
});
