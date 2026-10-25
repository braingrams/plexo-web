import { describe, expect, it } from "vitest";
import { applyActiveNav, markActiveNavLinks, normalizePath } from "@/lib/pub/activeNav";

const nav = (links: string) => `<html><head></head><body><nav class="plx-menu"><ul>${links}</ul></nav><main><a href="/about">in page</a></main></body></html>`;
const L = (href: string, t = href) => `<li><a href="${href}">${t}</a></li>`;

describe("active menu link", () => {
  it("normalises addresses", () => {
    expect(normalizePath("/About/")).toBe("/about");
    expect(normalizePath("/about.html?x=1#y")).toBe("/about");
    expect(normalizePath("/index.html")).toBe("/");
    expect(normalizePath("")).toBe("/");
  });

  it("marks the link of the current page, and only inside the menu", () => {
    const out = markActiveNavLinks(nav(L("/") + L("/about") + L("/contact")), "/about", "x.com");
    expect(out).toContain('<a href="/about" aria-current="page">');
    expect(out.match(/aria-current/g)).toHaveLength(1);
    expect(out).toContain('<a href="/about">in page</a>'); // the link in the page body is untouched
  });

  it("Home is only active on the home page", () => {
    expect(markActiveNavLinks(nav(L("/") + L("/about")), "/about", "x.com")).not.toContain('<a href="/" aria-current');
    expect(markActiveNavLinks(nav(L("/") + L("/about")), "/", "x.com")).toContain('<a href="/" aria-current="page">');
  });

  it("a section stays active on its sub-pages, the most specific link winning", () => {
    const out = markActiveNavLinks(nav(L("/blog") + L("/blog/news")), "/blog/news/a-post", "x.com");
    expect(out).toContain('<a href="/blog/news" aria-current="page">');
    expect(out).not.toContain('<a href="/blog" aria-current');
    expect(markActiveNavLinks(nav(L("/blog") + L("/about")), "/blog/my-post", "x.com")).toContain('<a href="/blog" aria-current="page">');
  });

  it("understands .html links, full links to this site and both copies of a link", () => {
    expect(markActiveNavLinks(nav(L("/about.html")), "/about", "x.com")).toContain("aria-current");
    expect(markActiveNavLinks(nav(L("https://www.x.com/about")), "/about", "x.com")).toContain("aria-current");
    expect(markActiveNavLinks(nav(L("https://other.com/about")), "/about", "x.com")).not.toContain("aria-current");
    const two = `<nav><ul>${L("/about")}</ul><details><ul>${L("/about")}</ul></details></nav>`;
    expect(markActiveNavLinks(two, "/about", "x.com").match(/aria-current/g)).toHaveLength(2);
  });

  it("ignores anchors, phone links and relative links, and respects a site that marks its own", () => {
    expect(markActiveNavLinks(nav(L("#top") + L("tel:123") + L("about")), "/about", "x.com")).not.toContain("aria-current");
    const own = `<nav><a class="active" href="/">Home</a><a href="/about">About</a></nav>`;
    expect(markActiveNavLinks(own, "/about", "x.com")).toBe(own);
  });

  it("gives the editor's menus an underline for it, once", () => {
    const out = applyActiveNav(nav(L("/about")), "/about", "x.com");
    expect(out).toContain('.plx-menu a[aria-current="page"]');
    expect(applyActiveNav(out, "/about", "x.com").match(/data-plexo-active-nav/g)).toHaveLength(1);
    expect(applyActiveNav("<p>no menu</p>", "/", "x.com")).toBe("<p>no menu</p>");
  });
});
