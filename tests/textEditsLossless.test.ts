import { describe, expect, it } from "vitest";
import { applyTextEdits, extractTextNodes } from "@/lib/htmlTextExtraction";

const PAGE = `<!DOCTYPE html>
<html lang='en'>
<head><meta charset=utf-8><title>T</title><style>.a>b{color:red}</style></head>
<body class=home>
  <!-- keep <b>me</b> -->
  <nav><a href=/about class='x'>About  us</a> <a href="/shop">Shop &amp; more</a></nav>
  <h1 id="top">Hello <em>big</em> world</h1>
  <p>First paragraph
  <p>Fish &eacute; &nbsp;chips<br>
  <img src='a.png' alt="A" /><input disabled>
  <script>if (a < b) { x() }</script>
</body>
</html>`;

const idOf = (text: string) => extractTextNodes(PAGE).find((n) => n.text.startsWith(text))!.id;

describe("Text view saves without rewriting the rest of the page", () => {
  it("no edits means the same page, byte for byte", () => {
    expect(applyTextEdits(PAGE, [])).toBe(PAGE);
  });
  it("changes only the words that were changed", () => {
    const out = applyTextEdits(PAGE, [{ id: idOf("Hello"), text: "Welcome" }]);
    expect(out).toBe(PAGE.replace("Hello <em>", "Welcome <em>"));
  });
  it("keeps spacing around the words and the original quote and entity styles elsewhere", () => {
    const out = applyTextEdits(PAGE, [{ id: idOf("About"), text: "Who we are" }, { id: idOf("Shop"), text: "Buy" }]);
    expect(out).toBe(PAGE.replace("About  us", "Who we are").replace("Shop &amp; more", "Buy"));
  });
  it("saving the same words again leaves the page's own spelling alone", () => {
    const out = applyTextEdits(PAGE, [{ id: idOf("Fish"), text: extractTextNodes(PAGE).find((n) => n.text.startsWith("Fish"))!.text }, { id: idOf("Shop"), text: "Shop & more" }]);
    expect(out).toBe(PAGE);
  });
  it("writes <, > and & safely", () => {
    const out = applyTextEdits(PAGE, [{ id: idOf("First"), text: "a < b & c" }]);
    expect(out).toContain("<p>a &lt; b &amp; c\n  <p>Fish");
  });
  it("changes a link's address in its own quote style, and only that", () => {
    const out = applyTextEdits(PAGE, [{ id: idOf("About"), text: "About  us", href: "/team" }]);
    expect(out).toBe(PAGE.replace("href=/about", 'href="/team"'));
    const shop = applyTextEdits(PAGE, [{ id: idOf("Shop"), text: "Shop & more", href: "/store?a=1&b=2" }]);
    expect(shop).toBe(PAGE.replace('href="/shop"', 'href="/store?a=1&amp;b=2"'));
  });
  it("adds an address to a link that had none", () => {
    const html = "<body><a>Go</a></body>";
    expect(applyTextEdits(html, [{ id: 0, text: "Go", href: "/x" }])).toBe('<body><a href="/x">Go</a></body>');
  });
  it("still works on a page with no <html> or <body> written", () => {
    expect(applyTextEdits("<h1>Hi</h1><p>there</p>", [{ id: 1, text: "you" }])).toBe("<h1>Hi</h1><p>you</p>");
  });
});

import { applyImageEdits } from "@/lib/htmlImageExtraction";

describe("Picture changes in Text view", () => {
  it("changing nothing returns the same page", () => {
    expect(applyImageEdits(PAGE, [], [])).toBe(PAGE);
  });
  it("a new picture changes only the picture's address", () => {
    expect(applyImageEdits(PAGE, [{ id: 0, src: "https://x.test/new.png" }], [])).toBe(PAGE.replace("src='a.png'", "src='https://x.test/new.png'"));
  });
  it("a picture address with a quote is kept safe", () => {
    expect(applyImageEdits('<body><img src="a.png"></body>', [{ id: 0, src: 'a"b.png' }], [])).toBe('<body><img src="a&quot;b.png"></body>');
  });
});
