import { describe, expect, it } from "vitest";
import { annotateForDesign, applyElementEdit, applyReplacements, decodeEntities, describeElement, designBridgeScript, encodeAttr, encodeText, insertBeforeBodyClose, parseSource } from "@/lib/editorModes/htmlSource";

const PAGE = `<!DOCTYPE html>
<html lang='en'>
<head><meta charset=utf-8><title>My &amp; page</title><style>.a>b{color:red}</style></head>
<body class=home>
  <!-- a comment <b>not a tag</b> -->
  <header><nav><a href=/about class='x'>About  us</a><a href="/shop">Shop &amp; more</a></nav></header>
  <h1 id="top">Hello <em>big</em> world</h1>
  <p>First paragraph
  <p>Second one with a 1 < 2 sign
  <img src='a.png' alt="A &quot;logo&quot;" /><img src=b.png>
  <ul><li>One<li>Two</ul>
  <a href="/go"><img src="c.png" alt=""></a>
  <script>if (a < b && c > d) { document.write("<p>hi</p>") }</script>
  <div id="app"></div>
</body>
</html>`;

const tags = (html: string) => parseSource(html).elements.map((e) => e.name);
const find = (html: string, pick: (e: ReturnType<typeof parseSource>["elements"][number]) => boolean) => parseSource(html).elements.find(pick)!.index;

describe("parseSource", () => {
  it("finds every start tag in order, ignoring comments and script/style text", () => {
    expect(tags(PAGE)).toEqual(["html", "head", "meta", "title", "style", "body", "header", "nav", "a", "a", "h1", "em", "p", "p", "img", "img", "ul", "li", "li", "a", "img", "script", "div"]);
  });
  it("handles quoted, single-quoted, unquoted and bare attributes", () => {
    const doc = parseSource(PAGE);
    const a = doc.elements.find((e) => e.name === "a")!;
    expect(a.attrs.map((x) => [x.lname, x.value, x.quote])).toEqual([["href", "/about", ""], ["class", "x", "'"]]);
    const html = parseSource('<input disabled name="n" value=\'v\'>').elements[0];
    expect(html.attrs.map((x) => [x.lname, x.value])).toEqual([["disabled", null], ["name", "n"], ["value", "v"]]);
  });
  it("keeps > inside quoted values and a / inside unquoted values", () => {
    const el = parseSource('<a title="a > b" href=/x/y/>t</a>').elements[0];
    expect(el.attrs.find((a) => a.lname === "title")!.value).toBe("a > b");
    expect(el.attrs.find((a) => a.lname === "href")!.value).toBe("/x/y/");
  });
  it("assigns text to the element it is directly inside", () => {
    const doc = parseSource(PAGE);
    const h1 = doc.elements.find((e) => e.name === "h1")!;
    expect(h1.texts.map((t) => PAGE.slice(t.start, t.end))).toEqual(["Hello ", " world"]);
    const em = doc.elements.find((e) => e.name === "em")!;
    expect(em.texts.map((t) => PAGE.slice(t.start, t.end))).toEqual(["big"]);
    expect(doc.elements.find((e) => e.name === "script")!.texts).toEqual([]);
  });
  it("closes <p> and <li> the way a browser does, without reporting problems", () => {
    const doc = parseSource(PAGE);
    expect(doc.issues).toEqual([]);
    const ps = doc.elements.filter((e) => e.name === "p");
    expect(ps[1].parent).toBe(ps[0].parent);
    const lis = doc.elements.filter((e) => e.name === "li");
    expect(lis[1].parent).toBe(lis[0].parent);
  });
  it("treats a lone < as text", () => {
    const doc = parseSource(PAGE);
    const p2 = doc.elements.filter((e) => e.name === "p")[1];
    expect(p2.texts.map((t) => PAGE.slice(t.start, t.end)).join("")).toContain("1 < 2 sign");
  });
  it("is not fooled by script code that looks like tags", () => {
    expect(tags('<script>var s = "</div><p>";</script><p>x</p>')).toEqual(["script", "p"]);
  });
  it("copes with svg and self-closing tags", () => {
    const doc = parseSource('<svg viewBox="0 0 1 1"><path d="M0 0"/><text>Hi</text></svg><p>after</p>');
    expect(doc.issues).toEqual([]);
    expect(doc.elements.find((e) => e.name === "p")!.parent).toBe(-1);
  });
});

describe("problems", () => {
  const kinds = (html: string) => parseSource(html).issues.map((i) => i.kind);
  it("reports a tag that is never closed", () => {
    const issues = parseSource("<div><span>hi</div>").issues;
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: "mismatch", tag: "span", expected: "div" });
    expect(kinds("<section><p>x</p>")).toEqual(["unclosed"]);
  });
  it("reports a closing tag that was never opened", () => {
    expect(parseSource("<p>x</p></div>").issues[0]).toMatchObject({ kind: "stray-close", tag: "div" });
  });
  it("reports an unfinished tag, quote and comment", () => {
    expect(kinds('<a href="x>text</a>')).toEqual(["unclosed-quote"]);
    expect(kinds("<div class=a")).toEqual(["unclosed-tag"]);
    expect(kinds("<p>x</p><!-- never ends")).toEqual(["unclosed-comment"]);
  });
  it("reports repeated attributes", () => {
    expect(parseSource('<div class="a" class="b"></div>').issues[0]).toMatchObject({ kind: "duplicate-attr", attr: "class" });
  });
  it("does not complain about tags that close themselves or optional ends", () => {
    expect(kinds("<ul><li>a<li>b</ul><table><tr><td>1<td>2</table><br><img src=x>")).toEqual([]);
  });
});

describe("entities", () => {
  it("decodes the common ones and leaves unknown names", () => {
    expect(decodeEntities("A &amp; B &lt;c&gt; &quot;d&quot; &#39;e&#39; &#x41; &nbsp;|&madeup;")).toBe('A & B <c> "d" \'e\' A  |&madeup;');
  });
  it("encodes only what must be", () => {
    expect(encodeText("a < b & c > d \"q\"")).toBe('a &lt; b &amp; c &gt; d "q"');
    expect(encodeAttr('say "hi" & \'bye\'', '"')).toBe("say &quot;hi&quot; &amp; 'bye'");
    expect(encodeAttr('say "hi" & \'bye\'', "'")).toBe("say \"hi\" &amp; &#39;bye&#39;");
  });
});

describe("describeElement", () => {
  it("lists words and the link around them", () => {
    const doc = parseSource(PAGE);
    const about = find(PAGE, (e) => e.name === "a");
    expect(describeElement(doc, about)).toMatchObject({ kind: "text", label: "Menu item", texts: [{ id: 0, text: "About  us" }], link: { href: "/about" } });
    const shop = parseSource(PAGE).elements.filter((e) => e.name === "a")[1].index;
    expect(describeElement(doc, shop)!.texts[0].text).toBe("Shop & more");
  });
  it("reads a picture's address and description, and the link it sits in", () => {
    const doc = parseSource(PAGE);
    const imgs = doc.elements.filter((e) => e.name === "img");
    expect(describeElement(doc, imgs[0].index)).toMatchObject({ kind: "image", image: { src: "a.png", alt: 'A "logo"' }, link: null });
    expect(describeElement(doc, imgs[2].index)).toMatchObject({ kind: "image", link: { href: "/go" } });
  });
  it("says there is nothing to change in scripts, drawings and empty script-filled boxes", () => {
    const doc = parseSource(PAGE);
    expect(describeElement(doc, find(PAGE, (e) => e.name === "script"))!.kind).toBe("other");
    expect(describeElement(doc, find(PAGE, (e) => e.name === "div"))!.kind).toBe("other");
    const svg = parseSource("<svg><text>Hi</text></svg>");
    expect(describeElement(svg, 1)!.kind).toBe("other");
  });
});

describe("applyElementEdit: round trips without loss", () => {
  it("changing nothing returns the page byte for byte", () => {
    const doc = parseSource(PAGE);
    for (const el of doc.elements) expect(applyElementEdit(PAGE, el.index, {}, doc)).toBe(PAGE);
  });
  it("re-saving the same words changes nothing", () => {
    const doc = parseSource(PAGE);
    for (const el of doc.elements) {
      const info = describeElement(doc, el.index)!;
      if (info.texts.length) expect(applyElementEdit(PAGE, el.index, { texts: info.texts }, doc)).toBe(PAGE);
    }
  });
  it("changes only the words, keeping the spacing around them and every other byte", () => {
    const h1 = find(PAGE, (e) => e.name === "h1");
    const out = applyElementEdit(PAGE, h1, { texts: [{ id: 0, text: "Welcome" }] });
    expect(out).toBe(PAGE.replace("Hello <em>", "Welcome <em>"));
  });
  it("writes & and < safely, and keeps the original line breaks around text", () => {
    const p = parseSource(PAGE).elements.filter((e) => e.name === "p")[0].index;
    const out = applyElementEdit(PAGE, p, { texts: [{ id: 0, text: "Fish & <chips>" }] });
    expect(out).toContain("<p>Fish &amp; &lt;chips&gt;\n  <p>Second");
  });
  it("changes a link keeping its quote style, and adds one when it was unquoted", () => {
    const about = find(PAGE, (e) => e.name === "a");
    const out = applyElementEdit(PAGE, about, { href: "/who we are?a=1&b=2" });
    expect(out).toContain('<a href="/who we are?a=1&amp;b=2" class=\'x\'>');
    const shop = parseSource(PAGE).elements.filter((e) => e.name === "a")[1].index;
    expect(applyElementEdit(PAGE, shop, { href: '/s"hop' })).toContain('<a href="/s&quot;hop">');
  });
  it("adds a link address to a link that had none", () => {
    expect(applyElementEdit("<a>Go</a>", 0, { href: "/x" })).toBe('<a href="/x">Go</a>');
  });
  it("changes a picture's source and description in place, including a self-closing tag and an unquoted source", () => {
    const imgs = parseSource(PAGE).elements.filter((e) => e.name === "img");
    const one = applyElementEdit(PAGE, imgs[0].index, { src: "new.png", alt: "Fresh" });
    expect(one).toContain("<img src='new.png' alt=\"Fresh\" />");
    const two = applyElementEdit(PAGE, imgs[1].index, { src: "https://x.test/p q.png" });
    expect(two).toContain('<img src="https://x.test/p q.png">');
    const none = applyElementEdit('<img src="a.png">', 0, { alt: "Cat" });
    expect(none).toBe('<img alt="Cat" src="a.png">');
  });
  it("changes a picture inside a link and the link in one go", () => {
    const inLink = parseSource(PAGE).elements.filter((e) => e.name === "img")[2].index;
    const out = applyElementEdit(PAGE, inLink, { src: "d.png", href: "/new" });
    expect(out).toContain('<a href="/new"><img src="d.png" alt=""></a>');
  });
  it("only touches the characters it was asked to (everything outside the edit is identical)", () => {
    const doc = parseSource(PAGE);
    const em = doc.elements.find((e) => e.name === "em")!;
    const out = applyElementEdit(PAGE, em.index, { texts: [{ id: 0, text: "tiny" }] });
    const run = em.texts[0];
    expect(out.slice(0, run.start)).toBe(PAGE.slice(0, run.start));
    expect(out.slice(run.start + 4)).toBe(PAGE.slice(run.end));
  });
  it("the edited page is still read the same way (same tags, same problems)", () => {
    const h1 = find(PAGE, (e) => e.name === "h1");
    const out = applyElementEdit(PAGE, h1, { texts: [{ id: 0, text: "<b>Hi</b> & bye" }] });
    expect(tags(out)).toEqual(tags(PAGE));
    expect(parseSource(out).issues).toEqual([]);
  });
  it("a bad id or index changes nothing", () => {
    expect(applyElementEdit(PAGE, 9999, { texts: [{ id: 0, text: "x" }] })).toBe(PAGE);
    expect(applyElementEdit(PAGE, 0, { texts: [{ id: 99, text: "x" }] })).toBe(PAGE);
  });
});

describe("annotateForDesign", () => {
  it("numbers body elements to match the source, and leaves the head alone", () => {
    const out = annotateForDesign(PAGE);
    const doc = parseSource(PAGE);
    expect(out).toContain(`<h1 data-plx-i="${doc.elements.find((e) => e.name === "h1")!.index}" id="top">`);
    expect(out).toContain('<meta charset=utf-8>');
    expect(out).not.toMatch(/<script data-plx-i/);
    expect(out).not.toMatch(/<title data-plx-i/);
  });
  it("never changes anything except adding the numbers", () => {
    expect(annotateForDesign(PAGE).replace(/ data-plx-i="\d+"/g, "")).toBe(PAGE);
  });
  it("describes the same element the number points to", () => {
    const out = annotateForDesign(PAGE);
    const n = Number(/<h1 data-plx-i="(\d+)"/.exec(out)![1]);
    expect(describeElement(parseSource(PAGE), n)!.tag).toBe("h1");
  });
});

describe("small helpers", () => {
  it("inserts before the last real </body>, ignoring one inside a script", () => {
    expect(insertBeforeBodyClose("<body><script>x='</body>'</script>hi</body></html>", "<i/>")).toBe("<body><script>x='</body>'</script>hi<i/></body></html>");
    expect(insertBeforeBodyClose("<p>no body</p>", "<i/>")).toBe("<p>no body</p><i/>");
  });
  it("applies several replacements without shifting each other", () => {
    expect(applyReplacements("abcdef", [{ start: 0, end: 1, text: "XX" }, { start: 4, end: 6, text: "" }])).toBe("XXbcd");
  });
  it("the preview script reports clicks and blocks navigation", () => {
    const s = designBridgeScript();
    expect(s).toContain("postMessage");
    expect(s).toContain("preventDefault");
    expect(s).toContain("data-plx-i");
  });
});
