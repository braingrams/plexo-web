import { describe, expect, it } from "vitest";
import { lintHtml, problemSummary } from "@/lib/editorModes/htmlLint";

describe("lintHtml", () => {
  it("is quiet for a healthy page", () => {
    expect(lintHtml('<!DOCTYPE html><html><head><title>x</title></head><body><h1 id="a">Hi</h1><img src="a.png" alt="A cat"><ul><li>a<li>b</ul></body></html>')).toEqual([]);
  });
  it("says which tag is never closed, and on which line, in plain words", () => {
    const p = lintHtml("<main>\n<section>\n<p>hi</p>\n</main>");
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ severity: "error", line: 2 });
    expect(p[0].message).toBe("The <section> on line 2 is still open when </main> arrives. Close it first with </section>.");
  });
  it("tells you about a closing tag with nothing to close", () => {
    const [p] = lintHtml("<p>x</p>\n\n</div>");
    expect(p.line).toBe(3);
    expect(p.message).toContain("closing </div> on line 3");
  });
  it("covers unfinished tags, quotes and comments", () => {
    expect(lintHtml('<a href="x>y</a>')[0].message).toContain("A quote is never closed");
    expect(lintHtml("<div class=a")[0].message).toContain('missing its closing ">"');
    expect(lintHtml("<p>x</p><!-- open")[0].message).toContain("comment");
  });
  it("suggests, but does not insist, on picture descriptions and unique ids", () => {
    const p = lintHtml('<img src="a.png"><div id="x"></div><div id="x"></div>');
    expect(p.map((x) => x.severity)).toEqual(["hint", "hint"]);
    expect(p[0].message).toContain("no description");
    expect(p[1].message).toContain('share the id "x"');
  });
  it("points at positions inside the page, in order", () => {
    const html = "<div><p>x</div>\n<span>";
    const p = lintHtml(html);
    expect(p.map((x) => x.from)).toEqual([...p.map((x) => x.from)].sort((a, b) => a - b));
    for (const x of p) expect(x.to).toBeLessThanOrEqual(html.length);
  });
  it("never reports more than a screenful", () => {
    expect(lintHtml("<i>".repeat(500)).length).toBeLessThanOrEqual(50);
  });
  it("keeps no jargon in what it says", () => {
    const all = lintHtml("<div><span></div></p>\n<a href=\"x>").map((x) => x.message).join(" ");
    expect(all).not.toMatch(/\b(DOM|node|parse|syntax|token|element)\b/i);
  });
});

describe("problemSummary", () => {
  it("counts things to fix and suggestions", () => {
    expect(problemSummary([])).toBe("");
    expect(problemSummary(lintHtml("<div>"))).toBe("1 thing to fix");
    expect(problemSummary(lintHtml("<div><span><img src=a>"))).toBe("2 things to fix and 1 suggestion");
  });
});
