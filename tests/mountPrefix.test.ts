import { describe, expect, it } from "vitest";
import { cleanPathFor, mountedSegments, normalizeMountPrefix, unmountLocation, unmountText } from "@/lib/pub/mountPrefix";

const opts = { prefix: "/serenity", sourceOrigin: "https://playmuzingo.com", siteOrigin: "https://www.serenitypastherapy.com" };

describe("serving a folder's site at the domain root", () => {
  it("normalises the folder", () => {
    expect(normalizeMountPrefix("serenity/")).toBe("/serenity");
    expect(normalizeMountPrefix("/a/b")).toBe("/a/b");
    expect(normalizeMountPrefix("/")).toBeNull();
    expect(normalizeMountPrefix(undefined)).toBeNull();
    expect(normalizeMountPrefix("/<script>")).toBeNull();
  });

  it("maps a visitor's path to the stored one", () => {
    expect(mountedSegments("/serenity", [])).toEqual(["serenity"]);
    expect(mountedSegments("/serenity", ["about-us"])).toEqual(["serenity", "about-us"]);
  });

  it("sends the old folder addresses to the clean ones", () => {
    expect(cleanPathFor("/serenity", ["serenity"])).toBe("/");
    expect(cleanPathFor("/serenity", ["serenity", "about-us"])).toBe("/about-us");
    expect(cleanPathFor("/serenity", ["about-us"])).toBeNull();
    expect(cleanPathFor("/serenity", ["serenity-more"])).toBeNull();
  });

  it("shortens root-relative links in pages, styles and scripts", () => {
    const html = '<a href="/serenity/about-us/">About</a> <a href="/serenity">Home</a> <img src="/serenity/wp-content/a.jpg" srcset="/serenity/wp-content/a-300.jpg 300w, /serenity/wp-content/a-600.jpg 600w">';
    expect(unmountText(html, opts)).toBe('<a href="/about-us/">About</a> <a href="/">Home</a> <img src="/wp-content/a.jpg" srcset="/wp-content/a-300.jpg 300w, /wp-content/a-600.jpg 600w">');
    expect(unmountText("background:url(/serenity/wp-content/x.png)", opts)).toBe("background:url(/wp-content/x.png)");
    expect(unmountText('{"u":"\\/serenity\\/wp-json\\/x"}', opts)).toBe('{"u":"\\/wp-json\\/x"}');
  });

  it("names the site's own address in canonical tags, not the old one", () => {
    const html = '<link rel="canonical" href="https://playmuzingo.com/serenity/about-us/"><meta property="og:url" content="https://www.playmuzingo.com/serenity/">';
    expect(unmountText(html, opts)).toBe('<link rel="canonical" href="https://www.serenitypastherapy.com/about-us/"><meta property="og:url" content="https://www.serenitypastherapy.com/">');
  });

  it("leaves other paths and other sites alone", () => {
    const html = '<a href="/serenity-more/">x</a> <a href="https://other.com/serenity/x">y</a> <a href="/blog/serenity/">z</a>';
    expect(unmountText(html, opts)).toBe('<a href="/serenity-more/">x</a> <a href="https://other.com/serenity/x">y</a> <a href="/blog/serenity/">z</a>');
  });

  it("cleans a redirect that points into the folder", () => {
    expect(unmountLocation("/serenity", "/serenity/about-us/", "https://www.serenitypastherapy.com/about-us")).toBe("/about-us/");
    expect(unmountLocation("/serenity", "https://elsewhere.com/serenity/x", "https://www.serenitypastherapy.com/")).toBe("https://elsewhere.com/serenity/x");
    expect(unmountLocation("/serenity", "/contact/?x=1", "https://www.serenitypastherapy.com/")).toBe("/contact/?x=1");
  });
});
