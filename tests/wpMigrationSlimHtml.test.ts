import { describe, expect, it } from "vitest";
import { pinCssUrls, slimForStorage } from "@/lib/wpMigration/slimHtml";

const big = (n: number, ch = "a") => ch.repeat(n);

describe("oversized migrated pages", () => {
  it("a page that fits is stored exactly as it is", async () => {
    const html = "<html><head><style>body{color:red}</style></head><body>Hi</body></html>";
    expect(await slimForStorage(html, "/", async () => {})).toBe(html);
  });

  it("moves the biggest inline CSS (WP Rocket's used CSS) into a file loaded from the same place", async () => {
    const saved: Record<string, string> = {};
    const html = `<html><head><style id="first">h1{color:blue}</style><style id="wpr-usedcss" media="all">.x{background:url(img/bg.png)}${big(50_000)}</style><style id="after">h2{}</style></head><body><p>${big(5_000, "b")}</p></body></html>`;
    const out = await slimForStorage(html, "/pricing/", async (rel, body) => void (saved[rel] = body.toString()), 20_000);
    const [rel] = Object.keys(saved);
    expect(rel).toMatch(/^plexo-inline\/[0-9a-f]{20}\.css$/);
    expect(saved[rel]).toContain("url(/pricing/img/bg.png)"); // relative url pinned to where it pointed on the page
    expect(out).toMatch(new RegExp(`<style id="first">.*</style><link rel="stylesheet" href="/${rel}" id="wpr-usedcss" media="all"><style id="after">`));
    expect(Buffer.byteLength(out)).toBeLessThan(20_000);
  });

  it("only moves plain scripts, keeps their attributes, and drops async/defer so they still run in order", async () => {
    const saved: string[] = [];
    const html = `<html><body><script type="application/json" id="data">${big(30_000)}</script><script type="rocketlazyloadscript">${big(30_000)}</script><script id="app" async>var a=1;${big(30_000)}</script></body></html>`;
    const out = await slimForStorage(html, "/", async (rel) => void saved.push(rel), 70_000);
    expect(saved).toHaveLength(1);
    expect(out).toMatch(/<script src="\/plexo-inline\/[0-9a-f]{20}\.js" id="app"><\/script>/);
    expect(out).toContain('<script type="application/json" id="data">');
    expect(out).toContain('<script type="rocketlazyloadscript">');
  });

  it("says plainly when a page is mostly markup and still too big", async () => {
    await expect(slimForStorage(`<p>${big(400_000)}</p>`, "/", async () => {})).rejects.toThrow(/too large to store/);
  });

  it("pins only relative CSS urls", () => {
    expect(pinCssUrls("a{b:url('../f/a.woff')}c{d:url(/x.png)}e{f:url(data:image/png;base64,AA)}g{h:url(https://cdn/x.png)}", "/blog/post/")).toBe(
      "a{b:url('/blog/f/a.woff')}c{d:url(/x.png)}e{f:url(data:image/png;base64,AA)}g{h:url(https://cdn/x.png)}",
    );
  });
});

describe("whitespace", () => {
  it("indentation between tags collapses; <pre>, <textarea>, scripts and styles keep theirs", async () => {
    const { collapseWhitespace } = await import("@/lib/wpMigration/slimHtml");
    const html = "<div>\n\t\t\t\t<p>Hello    world</p>\n\n\t\t</div><pre>  keep\n\n    this</pre><textarea>a\n\n  b</textarea><script>var  a = 1;\n\n  b()</script>";
    expect(collapseWhitespace(html)).toBe("<div>\n<p>Hello world</p>\n</div><pre>  keep\n\n    this</pre><textarea>a\n\n  b</textarea><script>var  a = 1;\n\n  b()</script>");
  });
});
