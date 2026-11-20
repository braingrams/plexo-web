import { describe, expect, it } from "vitest";
import { compileDesignJsonForKind } from "@/lib/compileForKind";
import { applyTextEdits, extractTextNodes } from "@/lib/htmlTextExtraction";
import { lintHtml } from "@/lib/editorModes/htmlLint";
import { formatHtml } from "@/lib/editorModes/htmlFormat";
import { annotateForDesign, applyElementEdit, describeElement, parseSource } from "@/lib/editorModes/htmlSource";
import { normalizeHtml } from "@/lib/editorModes/convertToCode";

// Design, Code and Text are one page seen three ways: a change made in one is exactly what the others see, and nothing
// else about the page moves. These run on pages the real classic compiler produced, the same pages a conversion turns into code.
const el = (id: string, type: string, attributes: Record<string, unknown>, style: Record<string, unknown> = {}) => ({ id, type, style, attributes });
const design = {
  body: {
    style: { background: "#fff" },
    rows: [
      { id: "r1", style: {}, columns: [{ id: "c1", width: "100%", elements: [el("e1", "heading", { text: "Welcome to Rosa's Bakery" }), el("e2", "paragraph", { text: "Fresh bread & cakes, every day." }), el("e3", "button", { text: "Order now", href: "/shop" }), el("e4", "image", { src: "https://img.test/a.png", alt: "Fresh bread" })] }] },
      { id: "r2", style: {}, columns: [{ id: "c2", width: "50%", elements: [el("e5", "heading", { text: "Opening hours" })] }, { id: "c3", width: "50%", elements: [el("e6", "paragraph", { text: "Mon to Fri, 8 to 5" })] }] },
    ],
  },
};

async function page(): Promise<string> {
  return compileDesignJsonForKind(design, "LANDING_PAGE");
}

/** How many characters at each end two strings share: everything between is "what changed". */
function changedSpan(a: string, b: string): { a: string; b: string } {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  let j = 0;
  while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
  return { a: a.slice(i, a.length - j), b: b.slice(i, b.length - j) };
}

describe("a compiled page is healthy code", () => {
  it("raises no mistakes, so a converted page never opens with false alarms", async () => {
    const html = await page();
    expect(html.length).toBeGreaterThan(500);
    expect(parseSource(html).issues).toEqual([]);
    expect(lintHtml(html).filter((p) => p.severity === "error")).toEqual([]);
  });
  it("tidying up does not change what the page is", async () => {
    const html = await page();
    expect(normalizeHtml(formatHtml(html))).toBe(normalizeHtml(html));
  });
});

describe("Design edits and the Text list agree", () => {
  it("every word the Text list shows can be found by clicking in Design, and vice versa", async () => {
    const html = await page();
    const fromText = extractTextNodes(html).map((n) => n.text).sort();
    const doc = parseSource(html);
    const fromDesign = doc.elements
      .map((e) => describeElement(doc, e.index)!)
      .filter((i) => i.kind !== "image" && !["head", "title", "style", "script"].includes(i.tag))
      .flatMap((i) => i.texts.map((t) => t.text))
      .sort();
    expect(fromText.length).toBeGreaterThanOrEqual(5);
    expect(fromDesign).toEqual(fromText);
  });

  it("a word changed in Design shows up in the Text list, and only those characters changed", async () => {
    const html = await page();
    const doc = parseSource(html);
    const h = doc.elements.find((e) => e.name === "h2" && describeElement(doc, e.index)!.texts[0]?.text === "Opening hours")!;
    const out = applyElementEdit(html, h.index, { texts: [{ id: 0, text: "When we're open" }] }, doc);
    expect(extractTextNodes(out).map((n) => n.text)).toContain("When we're open");
    expect(extractTextNodes(out).map((n) => n.text)).not.toContain("Opening hours");
    expect(changedSpan(html, out)).toEqual({ a: "Opening hours", b: "When we&#39;re open".replace("&#39;", "'") });
    expect(parseSource(out).issues).toEqual([]);
  });

  it("a word changed in Text is what Design shows next, and only those characters changed", async () => {
    const html = await page();
    const node = extractTextNodes(html).find((n) => n.text === "Mon to Fri, 8 to 5")!;
    const out = applyTextEdits(html, [{ id: node.id, text: "Every day, 7 to 7" }]);
    expect(changedSpan(html, out)).toEqual({ a: "Mon to Fri, 8 to 5", b: "Every day, 7 to 7" });
    const doc = parseSource(out);
    expect(doc.elements.map((e) => describeElement(doc, e.index)!).some((i) => i.texts.some((t) => t.text === "Every day, 7 to 7"))).toBe(true);
  });

  it("a link changed in Design and in Text lands in the same place", async () => {
    const html = await page();
    const doc = parseSource(html);
    const a = doc.elements.find((e) => e.name === "a")!;
    const viaDesign = applyElementEdit(html, a.index, { href: "/menu" }, doc);
    const node = extractTextNodes(html).find((n) => n.text === "Order now")!;
    const viaText = applyTextEdits(html, [{ id: node.id, text: "Order now", href: "/menu" }]);
    expect(viaDesign).toBe(viaText);
    expect(changedSpan(html, viaDesign)).toEqual({ a: "shop", b: "menu" });
  });

  it("a picture changed in Design leaves everything else alone", async () => {
    const html = await page();
    const doc = parseSource(html);
    const img = doc.elements.find((e) => e.name === "img")!;
    const out = applyElementEdit(html, img.index, { src: "https://img.test/b.png", alt: "Rosa's loaf" }, doc);
    expect(out.replace("https://img.test/b.png", "https://img.test/a.png").replace("Rosa&#39;s loaf", "Fresh bread").replace("Rosa's loaf", "Fresh bread")).toBe(html);
  });

  it("changing then changing back is a perfect round trip", async () => {
    const html = await page();
    const doc = parseSource(html);
    const h = doc.elements.find((e) => e.name === "h2")!;
    const original = describeElement(doc, h.index)!.texts[0].text;
    const there = applyElementEdit(html, h.index, { texts: [{ id: 0, text: "Something else entirely" }] }, doc);
    const back = applyElementEdit(there, h.index, { texts: [{ id: 0, text: original }] });
    expect(back).toBe(html);
  });

  it("the Design preview numbers match the code, element for element", async () => {
    const html = await page();
    const doc = parseSource(html);
    const marked = annotateForDesign(html, doc);
    for (const m of marked.matchAll(/<([a-z0-9]+) data-plx-i="(\d+)"/g)) expect(doc.elements[Number(m[2])].name).toBe(m[1]);
    expect(marked.replace(/ data-plx-i="\d+"/g, "")).toBe(html);
  });
});
