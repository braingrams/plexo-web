import { describe, expect, it } from "vitest";
import { parseBulkRedirects } from "@/lib/redirects/bulk";
import { closestPath, findBrokenLinks, internalLinks } from "@/lib/redirects/linkAudit";
import { worthRecording } from "@/lib/redirects/worth";

describe("bulk redirects", () => {
  it("reads commas, spaces, arrows, tabs and a 301/302 at the end", () => {
    const r = parseBulkRedirects("/a, /b\n/c /d 302\n/e -> https://x.com/f\n/g\t/h/");
    expect(r.problems).toEqual([]);
    expect(r.rows).toEqual([
      { fromPath: "/a", toPath: "/b", permanent: true },
      { fromPath: "/c", toPath: "/d", permanent: false },
      { fromPath: "/e", toPath: "https://x.com/f", permanent: true },
      { fromPath: "/g", toPath: "/h", permanent: true },
    ]);
  });
  it("skips a spreadsheet header and comments, and explains bad lines in plain words", () => {
    const r = parseBulkRedirects("from,to\n# note\nold /new\n/x /x\n/y\n/z /w\n/z /q");
    expect(r.rows.map((x) => x.fromPath)).toEqual(["/z"]);
    expect(r.problems.map((p) => p.line)).toEqual([3, 4, 5, 7]);
    expect(r.problems[0].reason).toMatch(/start with a slash/);
    expect(r.problems[1].reason).toMatch(/itself/);
    expect(r.problems[3].reason).toMatch(/already/);
  });
});

describe("broken-link audit", () => {
  const pages = [
    { name: "Home", path: "/", html: '<a href="/about">a</a><a href="/old-team">t</a><a href="https://me.com/contact?x=1">c</a><a href="mailto:a@b.c">m</a><a href="/files/menu.pdf">f</a><a href="#top">top</a>' },
    { name: "About", path: "/about", html: '<a href="/blog/hello">b</a><a href="/old-team">t</a><a href="https://other.com/zzz">o</a>' },
    { name: "Our team", path: "/our-team", html: "" },
    { name: "Contact", path: "/contact", html: "" },
  ];
  it("keeps only addresses on the site", () => {
    expect(internalLinks(pages[0].html, "me.com").sort()).toEqual(["/about", "/contact", "/old-team"]);
  });
  it("finds links to nowhere, says where they are, and suggests the closest page", () => {
    const b = findBrokenLinks(pages, { redirects: [], servedPrefixes: ["/blog"], host: "me.com" });
    expect(b).toEqual([{ href: "/old-team", pages: ["Home", "About"], suggestion: "/our-team" }]);
  });
  it("counts a redirect as a fix", () => {
    expect(findBrokenLinks(pages, { redirects: ["/old-team"], servedPrefixes: ["/blog"], host: "me.com" })).toEqual([]);
  });
  it("only suggests a page that really looks alike", () => {
    expect(closestPath("/pricing", ["/about", "/our-team"])).toBeNull();
  });
});

describe("404 recording", () => {
  it("ignores browser and bot housekeeping", () => {
    expect(worthRecording("/favicon.ico")).toBe(false);
    expect(worthRecording("/img/a.png")).toBe(false);
    expect(worthRecording("/.well-known/x")).toBe(false);
    expect(worthRecording("/old-page")).toBe(true);
  });
});
