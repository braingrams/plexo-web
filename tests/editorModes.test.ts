import { describe, expect, it } from "vitest";
import { formatHtml } from "@/lib/editorModes/htmlFormat";
import { checkSwitch, needsConfirmation } from "@/lib/editorModes/switchCheck";
import { classesInPage, cursorContext, tokenSuggestions } from "@/lib/editorModes/completions";

const squash = (s: string) => s.replace(/\s+/g, "");

describe("formatHtml", () => {
  const src = `<!DOCTYPE html><html><head><title>Hi</title><style>a{color:red}</style></head><body><div class="a"><h1>Hello <b>world</b></h1><p>Some   text</p><img src="x.png"><ul><li>One</li><li>Two</li></ul></div><pre>  keep
   this</pre></body></html>`;
  it("indents blocks and keeps short text on one line", () => {
    const out = formatHtml(src);
    expect(out).toContain("\n      <h1>Hello <b>world</b></h1>\n");
    expect(out).toContain("<li>One</li>");
    expect(out).toContain("  keep\n   this</pre>");
  });
  it("never changes the content", () => {
    expect(squash(formatHtml(src))).toBe(squash(src));
  });
  it("is stable when run twice", () => {
    const once = formatHtml(src);
    expect(formatHtml(once)).toBe(once);
  });
});

describe("checkSwitch", () => {
  it("is quiet for plain pages", () => {
    expect(checkSwitch({ html: "<p>Hi</p>", from: "code", to: "text", unsaved: false })).toEqual([]);
  });
  it("says it will save first", () => {
    expect(checkSwitch({ html: "<p>Hi</p>", from: "code", to: "text", unsaved: true })[0].kind).toBe("save");
  });
  it("warns about script-built content and frames going to Text only", () => {
    const html = `<div id=a></div><script>a.innerHTML="x"</script><iframe src="y"></iframe>`;
    expect(checkSwitch({ html, from: "code", to: "text", unsaved: false }).filter((n) => n.kind === "limit")).toHaveLength(2);
    expect(checkSwitch({ html, from: "text", to: "code", unsaved: false })).toEqual([]);
  });
});

describe("checkSwitch: Design view and broken code", () => {
  const scripty = `<div id=a></div><script>a.innerHTML="x"</script><iframe src="y"></iframe><svg><text>Hi</text></svg>`;
  it("warns about parts Design view can't change by clicking, in Design's own words", () => {
    const notes = checkSwitch({ html: scripty, from: "code", to: "design", unsaved: false });
    expect(notes.filter((n) => n.kind === "limit")).toHaveLength(3);
    expect(notes[0].text).toContain("Design view");
    expect(checkSwitch({ html: scripty, from: "code", to: "text", unsaved: false })[0].text).toContain("Text view");
  });
  it("is quiet going to Code, or between Design and Text, when nothing is wrong", () => {
    expect(checkSwitch({ html: scripty, from: "design", to: "code", unsaved: false })).toEqual([]);
    expect(checkSwitch({ html: "<p>Hi</p>", from: "design", to: "text", unsaved: false })).toEqual([]);
  });
  it("says so when the code has mistakes you are about to leave behind", () => {
    const notes = checkSwitch({ html: "<div><span>hi</div>", from: "code", to: "design", unsaved: false });
    expect(notes).toHaveLength(1);
    expect(notes[0].kind).toBe("broken");
    expect(notes[0].text).toContain("1 thing to fix");
    expect(checkSwitch({ html: "<div><i></div></p>", from: "code", to: "text", unsaved: false })[0].text).toContain("2 things to fix");
  });
  it("does not nag about suggestions (a picture with no description), only real mistakes", () => {
    expect(checkSwitch({ html: '<img src="a.png">', from: "code", to: "design", unsaved: false })).toEqual([]);
  });
  it("only stops you for things that matter, not for 'we'll save first'", () => {
    expect(needsConfirmation(checkSwitch({ html: "<p>x</p>", from: "code", to: "text", unsaved: true }))).toBe(false);
    expect(needsConfirmation(checkSwitch({ html: scripty, from: "code", to: "text", unsaved: true }))).toBe(true);
    expect(needsConfirmation(checkSwitch({ html: "<div>", from: "code", to: "design", unsaved: false }))).toBe(true);
  });
  it("never uses jargon", () => {
    const all = checkSwitch({ html: scripty + "<div>", from: "code", to: "text", unsaved: true }).map((n) => n.text).join(" ");
    expect(all).not.toMatch(/\b(DOM|parse|syntax|markup)\b/i);
  });
});

describe("completions", () => {
  it("finds the cursor context", () => {
    expect(cursorContext("color: var(--col")?.kind).toBe("token");
    expect(cursorContext('<div class="flex it')).toEqual({ kind: "class", from: 17 });
    expect(cursorContext("  <di")?.kind).toBe("tag");
    expect(cursorContext('<div data-plexo-com')?.kind).toBe("attr");
    expect(cursorContext("plain text")).toBeNull();
  });
  it("lists tokens and page classes", () => {
    expect(tokenSuggestions({ "brand-x": "#fff" }).some((t) => t.label === "--brand-x")).toBe(true);
    expect(tokenSuggestions().some((t) => t.label.startsWith("--color-"))).toBe(true);
    expect(classesInPage('<a class="btn  big">x</a><b class=\'x y\'>')).toEqual(["btn", "big", "x", "y"]);
  });
});
