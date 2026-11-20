import { describe, expect, it } from "vitest";
import { afterConvertHref, canConvertToCode, describeConvert, sourceChoices, finishConvertedHtml, normalizeHtml, samePageWithAdditions } from "@/lib/editorModes/convertToCode";
import { injectCustomJs } from "@/lib/pub/htmlInject";
import { staleRevisions } from "@/lib/revisionRetention";

describe("canConvertToCode", () => {
  it("allows ordinary block pages of either editor", () => {
    expect(canConvertToCode({ kind: "LANDING_PAGE", sourceType: "BUILDER" })).toEqual({ ok: true });
    expect(canConvertToCode({ kind: "LANDING_PAGE" })).toEqual({ ok: true });
  });
  it("says why not, in plain words, for everything else", () => {
    const why = (row: Parameters<typeof canConvertToCode>[0]) => {
      const r = canConvertToCode(row);
      return r.ok ? "" : r.reason;
    };
    expect(why({ kind: "EMAIL" })).toMatch(/Emails/);
    expect(why({ kind: "LANDING_PAGE", sourceType: "RAW_UPLOAD" })).toMatch(/already code/);
    expect(why({ kind: "LANDING_PAGE", sourceType: "REACT_PROJECT" })).toMatch(/app/);
    for (const flag of ["isBlogLayout", "isSiteLayoutFragment", "isCommerceLayout", "isLmsPageDesign"] as const) {
      expect(why({ kind: "LANDING_PAGE", sourceType: "BUILDER", [flag]: true })).toMatch(/shared by other pages/);
    }
  });
});

describe("normalizeHtml", () => {
  it("ignores spacing between tags, comments, quote style, attribute order and tag case", () => {
    const a = `<!DOCTYPE html><HTML><body><!-- hi --><div class='a b'   id=x>Hello   world</div>\n\n<a href="/x" title='t'>Go</a></body></HTML>`;
    const b = `<!doctype html>\n<html>\n  <body>\n    <div id="x" class="a b">Hello world</div>\n    <a title="t" href="/x">Go</a>\n  </body>\n</html>`;
    expect(normalizeHtml(a)).toBe(normalizeHtml(b));
  });
  it("notices a real difference", () => {
    expect(normalizeHtml("<p>One</p>")).not.toBe(normalizeHtml("<p>Two</p>"));
    expect(normalizeHtml('<a href="/a">x</a>')).not.toBe(normalizeHtml('<a href="/b">x</a>'));
    expect(normalizeHtml('<div class="a"></div>')).not.toBe(normalizeHtml('<div class="b"></div>'));
    expect(normalizeHtml("<p>a</p><p>b</p>")).not.toBe(normalizeHtml("<p>b</p><p>a</p>"));
    // a space between words and inline tags shows; a space next to a block tag doesn't
    expect(normalizeHtml("<p>Hello <b>x</b></p>")).not.toBe(normalizeHtml("<p>Hello<b>x</b></p>"));
    expect(normalizeHtml("<div> Hello </div>")).toBe(normalizeHtml("<div>Hello</div>"));
  });
  it("keeps code and preformatted text as written", () => {
    expect(normalizeHtml("<script>if (a  <  b) x()</script>")).not.toBe(normalizeHtml("<script>if (a < b) x()</script>"));
    expect(normalizeHtml("<pre>a  b</pre>")).not.toBe(normalizeHtml("<pre>a b</pre>"));
  });
});

describe("finishConvertedHtml and samePageWithAdditions", () => {
  const compiled = `<!doctype html><html><head><title>T</title></head><body><h1>Hi</h1><script>var keep = "</body>";</script></body></html>`;
  it("writes the classic page's own script exactly where it is added when the page is served", () => {
    const out = finishConvertedHtml(compiled, { customJs: "console.log(1)", classic: true });
    expect(out.html).toBe(injectCustomJs(compiled, "console.log(1)"));
    expect(out.html).toContain('<script>\nconsole.log(1)\n</script></body>');
    expect(out.added).toHaveLength(1);
  });
  it("adds nothing when there is no script, or for the new editor (which bakes its own)", () => {
    expect(finishConvertedHtml(compiled, { customJs: "  ", classic: true })).toEqual({ html: compiled, added: [] });
    expect(finishConvertedHtml(compiled, { customJs: "x()", classic: false })).toEqual({ html: compiled, added: [] });
  });
  it("accepts the page plus exactly what was added, and nothing else", () => {
    const out = finishConvertedHtml(compiled, { customJs: "go()", classic: true });
    expect(samePageWithAdditions(compiled, out.html, out.added)).toBe(true);
    expect(samePageWithAdditions(compiled, compiled, [])).toBe(true);
    expect(samePageWithAdditions(compiled, out.html.replace("<h1>Hi</h1>", "<h1>Hello</h1>"), out.added)).toBe(false);
    expect(samePageWithAdditions(compiled, out.html, [])).toBe(false);
    expect(samePageWithAdditions(compiled, compiled, ["<script>go()</script>"])).toBe(false);
  });
  it("accepts a brand link in the head as an addition", () => {
    const link = '<link rel="stylesheet" href="/b.css" data-plexo-brand>';
    const out = compiled.replace("</head>", link + "</head>");
    expect(samePageWithAdditions(compiled, out, [link])).toBe(true);
    expect(samePageWithAdditions(compiled, out, [])).toBe(false);
  });
});

describe("describeConvert", () => {
  it("tells the owner what comes along and what to know first, with no jargon", () => {
    const n = describeConvert({ hasHeader: true, hasFooter: true, hasUnpublishedChanges: false, isLive: true, hasOwnScript: true });
    expect(n.copied.join(" ")).toContain("header and footer");
    expect(n.copied.join(" ")).toContain("script you added");
    expect(n.heads.join(" ")).toContain("copied into this page");
    expect(n.heads.join(" ")).toContain("goes live straight away");
    expect(`${n.copied.join(" ")} ${n.heads.join(" ")}`).not.toMatch(/\b(HTML|DOM|compile|sanitis|JSON)\b/i);
  });
  it("is short for a simple, unpublished page", () => {
    const n = describeConvert({ hasHeader: false, hasFooter: false, hasUnpublishedChanges: false, isLive: false, hasOwnScript: false });
    expect(n.heads).toEqual([]);
    expect(n.copied).toHaveLength(2);
  });
});

describe("history cleaning keeps what a page can still go back to", () => {
  const revs = Array.from({ length: 25 }, (_, i) => ({ id: `r${i}` })); // newest first
  it("removes the oldest beyond the cap", () => {
    expect(staleRevisions(revs, 20, new Set()).map((r) => r.id)).toEqual(["r20", "r21", "r22", "r23", "r24"]);
  });
  it("never removes the backup made when a page became code", () => {
    expect(staleRevisions(revs, 20, new Set(["r24", "r3"])).map((r) => r.id)).toEqual(["r20", "r21", "r22", "r23"]);
  });
});

describe("which version becomes the code", () => {
  it("only asks when there are unpublished changes on a live page", () => {
    expect(sourceChoices({ hasUnpublishedChanges: false, isLive: true }).ask).toBe(false);
    expect(sourceChoices({ hasUnpublishedChanges: true, isLive: false }).ask).toBe(false);
    const c = sourceChoices({ hasUnpublishedChanges: true, isLive: true });
    expect(c.ask).toBe(true);
    expect(c.options.map((o) => o.value)).toEqual(["working", "live"]);
    expect(c.options[0].help).toContain("straight away");
    expect(c.options[1].help).toContain("backup");
  });
  it("opens the view that was asked for once the page is code", () => {
    expect(afterConvertHref("abc", "code")).toBe("/dashboard/templates/abc?mode=code");
    expect(afterConvertHref("abc", "text")).toBe("/dashboard/templates/abc?mode=text");
  });
});

import { needsPageBase } from "@/lib/pub/pageBase";

describe("a page that was blocks is served without a base address", () => {
  it("only a nested page of your own code with its own files needs one", () => {
    expect(needsPageBase({ id: "kid", sourceType: "RAW_UPLOAD" }, "root")).toBe(true);
    expect(needsPageBase({ id: "root", sourceType: "RAW_UPLOAD" }, "root")).toBe(false);
    expect(needsPageBase({ id: "kid", sourceType: "BUILDER" }, "root")).toBe(false);
  });
  it("a converted page doesn't, so its #anchors and /paths keep working", () => {
    expect(needsPageBase({ id: "kid", sourceType: "RAW_UPLOAD", convertedFromBlocksAt: "2026-11-19T10:00:00Z" }, "root")).toBe(false);
  });
});
