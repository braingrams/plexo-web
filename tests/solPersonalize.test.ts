import { describe, expect, it } from "vitest";
import { applyTextNodes, extractTextNodes, finishDesign, parseJsonObject, sanitizeQuestions } from "@/lib/onboarding/solPersonalize";
import { parseSolStudioHref, solStudioHref } from "@/lib/dashboardV3/solStudioLink";

const PAGE = `<!doctype html><html><head><title>Iron &amp; Grain: strength gym</title><style>.a{color:red}</style><script>var x = "Not text";</script></head>
<body class="x"><nav><a class="logo" href="/">IRON &amp; GRAIN</a></nav>
<h1>Lift <em>heavy</em></h1><p>  Open until 22:00  </p><svg><text>NOPE</text></svg><!-- hidden words --><img src="/a.jpg" alt="gym"><footer>&copy; 2026</footer></body></html>`;

describe("text of a design", () => {
  it("numbers only the visible words, in order, and skips code, comments and svg", () => {
    const texts = extractTextNodes(PAGE).map((n) => n.text);
    expect(texts).toEqual(["Iron & Grain: strength gym", "IRON & GRAIN", "Lift", "heavy", "Open until 22:00", "&copy; 2026"]);
  });

  it("puts rewritten words back without touching anything else", () => {
    const nodes = extractTextNodes(PAGE);
    const id = (t: string) => String(nodes.find((n) => n.text === t)!.id);
    const out = applyTextNodes(PAGE, { [id("IRON & GRAIN")]: "MUSTI & CO", [id("Open until 22:00")]: "Open daily <6am>" });
    expect(out).toContain('<a class="logo" href="/">MUSTI &amp; CO</a>');
    expect(out).toContain("<p>  Open daily &lt;6am&gt;  </p>");
    expect(out).toContain('var x = "Not text";');
    expect(out).toContain("<!-- hidden words -->");
    expect(out).toContain("<text>NOPE</text>");
    expect(out).toContain('<img src="/a.jpg" alt="gym">');
    // Untouched words stay byte-for-byte (including entities SOL never saw changed).
    expect(out).toContain("<h1>Lift <em>heavy</em></h1>");
    expect(out).toContain("&copy; 2026");
  });

  it("ignores empty replacements and unknown numbers", () => {
    expect(applyTextNodes(PAGE, { "99": "x", "1": "   " })).toBe(PAGE);
  });
});

describe("SOL's answers", () => {
  it("finds the JSON even when SOL wraps it", () => {
    expect(parseJsonObject('Sure!\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonObject("no json here")).toBeNull();
    expect(parseJsonObject("{broken")).toBeNull();
    expect(parseJsonObject("[1,2]")).toBeNull();
  });

  it("keeps at most three questions, each with real choices", () => {
    const q = (n: number) => ({ header: `H${n}`, question: `Question ${n}?`, options: [{ label: "A" }, { label: "B", description: "bee" }] });
    const out = sanitizeQuestions([q(1), { question: "No options?", options: [{ label: "only" }] }, "junk", q(2), q(3), q(4)]);
    expect(out.map((x) => x.question)).toEqual(["Question 1?", "Question 2?", "Question 3?"]);
    expect(out[0].options).toEqual([{ label: "A", description: undefined }, { label: "B", description: "bee" }]);
    expect(sanitizeQuestions("nope")).toEqual([]);
  });
});

describe("finishing a design", () => {
  const photos = '<img src="/old.jpg" alt=""><div style="background-image:url(/bg.jpg)"></div><img class="logo" src="/logo.png">';
  const base = { html: `<html><head></head><body>${photos}</body></html>`, replacements: {}, name: "Musti", design: { name: "Iron & Grain: strength gym", description: "gym coaching" } };

  it("keeps the design's own photos when it already fits the business", () => {
    const out = finishDesign({ ...base, domain: "fitness" });
    expect(out).toContain('src="/old.jpg"');
    expect(out).toContain("url(/bg.jpg)");
  });

  it("swaps photos (not the logo) when the design is for a different kind of business", () => {
    const out = finishDesign({ ...base, domain: "food" });
    expect(out).not.toContain('src="/old.jpg"');
    expect(out).not.toContain("url(/bg.jpg)");
    expect(out).toContain('src="/logo.png"');
    expect(out).toMatch(/images\.unsplash\.com/);
  });

  it("never swaps photos for a business it cannot place", () => {
    expect(finishDesign({ ...base, domain: "other" })).toContain('src="/old.jpg"');
  });

  it("puts the owner's logo and colour in and marks the page personalized", () => {
    const out = finishDesign({ ...base, domain: "other", logoUrl: "https://cdn.test/musti.png", brandColor: "#ff3300" });
    expect(out).toContain('src="https://cdn.test/musti.png"');
    expect(out).toContain("--primary:#ff3300");
    expect(out).toContain('<body data-sol-personalized="true">');
    expect(finishDesign({ ...base, domain: "other", brandColor: "red;}</style><script>" })).not.toContain("<script>");
  });

  it("swaps a text logo for the owner's logo image", () => {
    const out = finishDesign({ html: '<html><head></head><body><a class="logo" href="/">MUSTI</a></body></html>', replacements: {}, name: "Musti", domain: "other", design: {}, logoUrl: "https://cdn.test/m.png" });
    expect(out).toContain('<a class="logo" href="/"><img src="https://cdn.test/m.png" alt="Musti"');
  });
});

describe("Let SOL do it links", () => {
  it("round-trips a studio link and carries the site", () => {
    const href = solStudioHref('Fix "my" site & more', { siteId: "site_12345" });
    expect(href).toContain("studio=1");
    expect(parseSolStudioHref(href)).toEqual({ prompt: 'Fix "my" site & more', siteId: "site_12345" });
  });

  it("leaves plain Ask SOL links, other pages and empty prompts alone", () => {
    expect(parseSolStudioHref("/dashboard/sol?new=1&draft=Write%20an%20email%20for%20")).toBeNull();
    expect(parseSolStudioHref("/dashboard/settings?studio=1&draft=hi")).toBeNull();
    expect(parseSolStudioHref("/dashboard/sol?studio=1&draft=%20")).toBeNull();
    expect(parseSolStudioHref(solStudioHref("hi", { siteId: "../x" }))?.siteId).toBeNull();
  });
});
