import { describe, expect, it } from "vitest";
import { logoChange, logoSrcOf, syncDesignData, syncDesigns, unmatchedMessage } from "@/lib/onboarding/designTextSync";
import { findHeaderSection, logoCommandFor, withHeaderLogo } from "@/lib/sites/headerLogo";

// Realistic V2 shapes: a page is rootNode > sections whose block holds the content; the shared header and footer are their own designs.
const section = (id: string, kind: string, content: Record<string, unknown>) => ({ id, type: "section", props: { block: { kind, content } } });
const v2 = (...sections: unknown[]) => ({ format: "plexo-v2@1", pages: [{ id: "p1", name: "Home", slug: "", rootNode: { id: "root", type: "page", children: sections } }] });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const contentOf = (d: any, i: number) => d.pages[0].rootNode.children[i].props.block.content;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sync = (d: any, original: string, final: string) => syncDesignData(d, { originalHtml: original, finalHtml: final });

describe("finding the text in real design data", () => {
  it("matches text however the data spells it (entities, no-break spaces, curly quotes)", () => {
    const d = v2(section("a", "hero", { headline: "Fish &amp;  Chips", sub: "We’re open “daily” for everyone nearby" }));
    const original = "<h1>Fish &amp; Chips</h1><p>We&rsquo;re open &ldquo;daily&rdquo; for everyone nearby</p>";
    const final = "<h1>Aria Kitchen</h1><p>We are open every day for you</p>";
    const { design, report } = sync(d, original, final);
    expect(contentOf(design, 0)).toEqual({ headline: "Aria Kitchen", sub: "We are open every day for you" });
    expect(report.unmatched).toEqual([]);
  });

  it("changes only the words that changed inside rich text with inline tags, keeping the emphasis", () => {
    const d = v2(section("a", "hero", { headline: "Build <em>strong</em> habits that <strong>last</strong>" }));
    const original = "<h1>Build <em>strong</em> habits that <strong>last</strong></h1>";
    const final = "<h1>Build <em>strong</em> routines that <strong>last</strong></h1>";
    const { design, report } = sync(d, original, final);
    expect(contentOf(design, 0).headline).toBe("Build <em>strong</em> routines that <strong>last</strong>");
    expect(report.unmatched).toEqual([]);
  });

  it("matches a run whose tags the data writes differently from the page", () => {
    const d = v2(section("a", "hero", { headline: 'Welcome to <span class="x">Iron &amp; Grain</span> gym today' }));
    const { design, report } = sync(d, "<h1>Welcome to Iron &amp; Grain gym today</h1>", "<h1>Welcome to Aria gym today</h1>");
    expect(contentOf(design, 0).headline).toBe('Welcome to <span class="x">Aria</span> gym today');
    expect(report.unmatched).toEqual([]);
  });

  it("replaces the pieces one by one when the data keeps them in separate fields", () => {
    const d = v2(section("a", "hero", { headline: "Build", accent: "strong", tail: "habits" }));
    const { design, report } = sync(d, "<h1>Build <em>strong</em> habits</h1>", "<h1>Craft <em>lasting</em> habits</h1>");
    expect(contentOf(design, 0)).toEqual({ headline: "Craft", accent: "lasting", tail: "habits" });
    expect(report.unmatched).toEqual([]);
    expect(report.textsApplied).toBe(1);
  });

  it("changes the n-th of a repeated text, only when the data has as many to line up with", () => {
    const d = v2(section("a", "cta", { label: "Learn more" }), section("b", "cta", { label: "Learn more" }), section("c", "cta", { label: "Learn more" }));
    const original = "<a>Learn more</a><a>Learn more</a><a>Learn more</a>";
    const { design } = sync(d, original, "<a>Learn more</a><a>Find out more</a><a>Learn more</a>");
    expect([0, 1, 2].map((i) => contentOf(design, i).label)).toEqual(["Learn more", "Find out more", "Learn more"]);
    // the data has only two of them: it cannot be told which is which, so nothing is changed and it is reported
    const two = v2(section("a", "cta", { label: "Learn more" }), section("b", "cta", { label: "Learn more" }));
    const r = sync(two, original, "<a>Learn more</a><a>Find out more</a><a>Learn more</a>");
    expect([0, 1].map((i) => contentOf(r.design, i).label)).toEqual(["Learn more", "Learn more"]);
    expect(r.report.unmatched).toHaveLength(1);
  });

  it("finds text that lives in the site's shared header and footer, not in the page", () => {
    const page = v2(section("a", "hero", { headline: "Iron & Grain trains you well" }));
    const header = v2(section("h", "header", { brand: "Iron & Grain", links: [{ label: "Home", href: "/" }] }));
    const footer = v2(section("f", "footer", { about: "Iron &amp; Grain, a gym in Lagos", copyright: "© 2026 Iron & Grain" }));
    const original = "<a>Iron &amp; Grain</a><h1>Iron &amp; Grain trains you well</h1><p>Iron &amp; Grain, a gym in Lagos</p><small>© 2026 Iron &amp; Grain</small>";
    const final = "<a>Aria</a><h1>Aria trains you well</h1><p>Aria, a gym in Lagos</p><small>© 2026 Aria</small>";
    const { docs, report } = syncDesigns([{ design: page, role: "page" }, { design: header, role: "header" }, { design: footer, role: "footer" }], { originalHtml: original, finalHtml: final });
    expect(contentOf(docs[0].design, 0).headline).toBe("Aria trains you well");
    expect(contentOf(docs[1].design, 0).brand).toBe("Aria");
    expect(contentOf(docs[2].design, 0)).toEqual({ about: "Aria, a gym in Lagos", copyright: "© 2026 Aria" });
    expect(report.unmatched).toEqual([]);
    expect(report.problems).toEqual([]);
  });

  it("reports what it cannot place, in plain words, with the words the owner will look for", () => {
    const d = v2(section("a", "hero", { headline: "Something else entirely" }));
    const { report } = sync(d, "<h1>Generated by the compiler</h1><p>Keep</p>", "<h1>Aria's own headline</h1><p>Keep</p>");
    expect(report.unmatched).toEqual([{ from: "Generated by the compiler", to: "Aria's own headline" }]);
    expect(report.problems[0]).toContain("One piece of text couldn't be filled in automatically");
    expect(report.problems[0]).toContain("Aria's own headline");
    expect(report.problems[0]).toContain("Review and edit your pages");
    expect(report.problems[0]).not.toMatch(/json|html|token|design data/i);
  });

  it("words the message for several pieces and for none", () => {
    expect(unmatchedMessage([], 0)).toBeNull();
    expect(unmatchedMessage([{ from: "a", to: "b" }, { from: "c", to: "d" }], 1)).toContain("3 pieces of text couldn't be filled in automatically");
  });

  it("does not search the brand's own values for words, and leaves ids alone", () => {
    const d = { ...v2(section("Iron-Grain-id", "hero", { headline: "Iron & Grain" })), designSystem: { tokens: [{ key: "--note", value: "Iron & Grain" }], components: [] } };
    const { design } = sync(d, "<h1>Iron &amp; Grain</h1>", "<h1>Aria</h1>");
    expect(design.pages[0].rootNode.children[0]).toMatchObject({ id: "Iron-Grain-id" });
    expect(design.designSystem.tokens[0].value).toBe("Iron & Grain");
    expect(contentOf(design, 0).headline).toBe("Aria");
  });
});

describe("the logo", () => {
  const withLogo = '<header><a class="logo"><img src="https://x/old.png" alt="Iron"></a></header><h1>Hi</h1>';
  const wordmark = '<header><a class="logo">Iron &amp; Grain</a></header><h1>Hi</h1>';

  it("sees a logo that was added, replaced or removed", () => {
    expect(logoSrcOf(withLogo)).toBe("https://x/old.png");
    expect(logoSrcOf(wordmark)).toBeNull();
    expect(logoChange(wordmark, withLogo)).toEqual({ kind: "added", to: "https://x/old.png" });
    expect(logoChange(withLogo, withLogo.replace("old", "new"))).toEqual({ kind: "replaced", to: "https://x/new.png" });
    expect(logoChange(withLogo, wordmark)).toEqual({ kind: "removed", to: "" });
    expect(logoChange(withLogo, withLogo)).toBeNull();
    expect(logoSrcOf('<div class="brand"><span>x</span><img src="b.png"></div>')).toBe("b.png");
  });

  it("puts an added logo in the shared header when the site has one", () => {
    const page = v2(section("a", "hero", { headline: "Hi" }));
    const header = v2(section("h", "header", { brand: "Iron & Grain" }));
    const { docs, report } = syncDesigns([{ design: page, role: "page" }, { design: header, role: "header" }], { originalHtml: wordmark, finalHtml: withLogo });
    expect(contentOf(docs[1].design, 0).logo).toBe("https://x/old.png");
    expect(contentOf(docs[0].design, 0)).toEqual({ headline: "Hi" });
    expect(report.logoApplied).toBe(true);
  });

  it("puts it in the page's own header when there is no shared one (a marketplace design)", () => {
    const page = v2(section("h", "header", { brand: "Iron & Grain" }), section("a", "hero", { headline: "Hi" }));
    const { design, report } = sync(page, wordmark, withLogo);
    expect(contentOf(design, 0).logo).toBe("https://x/old.png");
    expect(report.logoApplied).toBe(true);
  });

  it("replaces and removes it: it is design data, so it survives a recompile", () => {
    const page = v2(section("h", "header", { brand: "x", logo: "https://x/old.png" }));
    expect(contentOf(sync(page, withLogo, withLogo.replace("old", "new")).design, 0).logo).toBe("https://x/new.png");
    expect(contentOf(sync(page, withLogo, wordmark).design, 0).logo).toBe("");
  });

  it("says so when the design has no header to carry the logo", () => {
    const { report } = sync(v2(section("a", "hero", { headline: "Hi" })), wordmark, withLogo);
    expect(report.logoApplied).toBe(false);
    expect(report.problems.join(" ")).toContain("Add it on the Brand page");
  });

  it("header helpers find the header, build the command and never change their input", () => {
    const d = v2(section("a", "hero", {}), { id: "c", type: "container", children: [section("h", "header", { logo: "https://x/a.png" })] });
    expect(findHeaderSection(d)).toEqual({ id: "h", logo: "https://x/a.png" });
    expect(logoCommandFor(d, "https://x/b.png")).toEqual({ op: "updateSection", sectionId: "h", content: { logo: "https://x/b.png" } });
    expect(logoCommandFor(v2(section("a", "hero", {})), "https://x/b.png")).toBeNull();
    const out = withHeaderLogo(d, "https://x/b.png");
    expect(out.placed).toBe(true);
    expect(findHeaderSection(out.design)?.logo).toBe("https://x/b.png");
    expect(findHeaderSection(d)?.logo).toBe("https://x/a.png");
    expect(withHeaderLogo(v2(), "x").placed).toBe(false);
  });
});
