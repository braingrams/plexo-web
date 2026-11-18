// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { applyEdit, buildPreviewDoc } from "@/lib/email/dragEdit";

const page = `<!DOCTYPE html><html><head><title>t</title></head><body><table><tbody><tr><td>One</td></tr><tr><td>Two</td></tr><tr><td>Three</td></tr></tbody></table></body></html>`;
// numbering (document order, body elements): 0 table, 1 tbody, 2 tr, 3 td, 4 tr, 5 td, 6 tr, 7 td

describe("drag and drop on email HTML", () => {
  it("numbers every element in the preview and strips scripts", () => {
    const doc = buildPreviewDoc(page + "<script>alert(1)</script>", { filled: false, scrollY: 0, interactive: false });
    expect(doc).toContain('data-plx-id="2"');
    expect(doc).not.toContain("alert(1)");
  });

  it("moves a row after another and keeps the rest", () => {
    const out = applyEdit(page, { type: "move", id: 2, target: 6, pos: "after" })!;
    expect(out.indexOf("Two")).toBeLessThan(out.indexOf("Three"));
    expect(out.indexOf("Three")).toBeLessThan(out.indexOf("One"));
    expect(out).toContain("<title>t</title>");
  });

  it("refuses to drop something into itself", () => {
    expect(applyEdit(page, { type: "move", id: 0, target: 4, pos: "after" })).toBeNull();
  });

  it("adds a new block as a row when dropped beside a row, and as an element inside a cell", () => {
    const row = applyEdit(page, { type: "insert", kind: "button", target: 4, pos: "after" })!;
    expect(row.indexOf("Two")).toBeLessThan(row.indexOf("Click here"));
    expect(row.indexOf("Click here")).toBeLessThan(row.indexOf("Three"));
    expect(row).toMatch(/<tr><td style="padding:0 24px;"><a /);
    const cell = applyEdit(page, { type: "insert", kind: "text", target: 3, pos: "inside" })!;
    expect(cell).toMatch(/<td>One<p /);
  });

  it("adds a dropped picture, copies and deletes", () => {
    expect(applyEdit(page, { type: "insertImage", url: "https://cdn.test/a.gif", alt: "a", target: 2, pos: "before" })).toContain('src="https://cdn.test/a.gif"');
    expect(applyEdit(page, { type: "duplicate", id: 4 })!.match(/Two/g)).toHaveLength(2);
    expect(applyEdit(page, { type: "remove", id: 6 })).not.toContain("Three");
  });

  it("works on a bare snippet without turning it into a whole page", () => {
    const out = applyEdit("<p>A</p><p>B</p>", { type: "move", id: 0, target: 1, pos: "after" })!;
    expect(out).toBe("<p>B</p><p>A</p>");
  });

  it("changes a block's text, and shows sample names as marked tags in the preview", () => {
    const out = applyEdit(page, { type: "text", id: 3, html: "Hi {{first_name}} <b>there</b><script>x()</script>" })!;
    expect(out).toContain("<td>Hi {{first_name}} <b>there</b></td>");
    expect(out).not.toContain("x()");
    const doc = buildPreviewDoc('<p>Hi {{first_name}}</p><a href="{{unsubscribe_url}}">Stop</a>', { filled: true, scrollY: 0, interactive: false });
    expect(doc).toContain('<span data-plx-tag="first_name">Ada</span>');
    expect(doc).toContain('href="https://example.com/unsubscribe"');
    expect(buildPreviewDoc("<p>{{first_name}}</p>", { filled: false, scrollY: 0, interactive: false })).toContain("{{first_name}}");
  });

  it("puts a merge tag after the last text on the page, not at the top, and never inside a link", () => {
    const html = "<table><tr><td>Hi there</td></tr><tr><td>Thanks <a href=\"#\">Unsubscribe</a></td></tr></table>";
    const out = applyEdit(html, { type: "appendTag", tag: "{{first_name}}" })!;
    expect(out).toContain("Thanks <a href=\"#\">Unsubscribe</a> {{first_name}}");
    expect(out.indexOf("{{first_name}}")).toBeGreaterThan(out.indexOf("Hi there"));
    expect(applyEdit("", { type: "appendTag", tag: "{{email}}" })).toBe("<p>{{email}}</p>");
  });
});
