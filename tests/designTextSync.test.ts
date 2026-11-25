import { describe, expect, it } from "vitest";
import { applyDescription, brandPreviewHtml, descriptionCopy } from "@/lib/onboarding/brandPreview";
import { metaChanges, pairImageChanges, pairTextChanges, syncDesignData, visibleRuns } from "@/lib/onboarding/designTextSync";

const ABOUT = "We bake fresh sourdough and celebration cakes in Lagos, delivered the same day.";
const page = `<html><head><title>Iron &amp; Grain</title><meta name="description" content="Strength coaching for everyone."><style>.btn{background:#e0b040}</style></head><body><a>Iron &amp; Grain</a><h1>Strength starts here</h1><p>Train with coaches who care about your progress every single week.</p><button>Join</button><p>Open daily</p></body></html>`;

describe("description on the design", () => {
  it("puts the owner's description where the hero sub-copy is, and in the search description", () => {
    const out = applyDescription(page, ABOUT);
    expect(out).toContain(ABOUT);
    expect(out).not.toContain("Train with coaches");
    expect(out).toContain(`<meta name="description" content="${ABOUT}">`);
    expect(out).toContain("<button>Join</button>");
    expect(out).toContain("Open daily");
  });
  it("does nothing for a short or design-instruction description", () => {
    expect(applyDescription(page, "a bakery")).toBe(page);
    expect(applyDescription(page, "I want a modern dark website with big photos")).toBe(page);
    expect(applyDescription(page, undefined)).toBe(page);
  });
  it("never makes the line more than 1.6x longer: cuts at a sentence", () => {
    const long = "We bake fresh sourdough every morning. We also make celebration cakes for every kind of party, big or small, in Lagos.";
    const original = "Train with coaches who care about your progress every single week.";
    expect(descriptionCopy(long, Math.floor(original.length * 1.6))).toBe("We bake fresh sourdough every morning.");
    expect(descriptionCopy("x".repeat(30), 10)).toBeNull();
  });
  it("leaves the body copy of a design without a main heading alone (only the search description changes)", () => {
    const out = applyDescription('<html><head><meta name="description" content="x"></head><body><p>Some long sample paragraph that is long enough to count as copy here.</p></body></html>', ABOUT);
    expect(out).toContain("Some long sample paragraph");
    expect(out).toContain(ABOUT);
  });
  it("is part of the brand preview", () => {
    const out = brandPreviewHtml(page, { name: "Aria", about: ABOUT, designName: "Iron & Grain: gym" });
    expect(out).toContain("Aria");
    expect(out).toContain(ABOUT);
  });
});

describe("pairing text changes", () => {
  it("finds what changed, in order, by position", () => {
    const { changes } = pairTextChanges("<h1>Iron &amp; Grain</h1><p>Sample copy that goes here.</p><b>Join</b>", "<h1>Aria</h1><p>Our own words.</p><b>Join</b>");
    expect(changes).toEqual([{ from: "Iron & Grain", to: "Aria" }, { from: "Sample copy that goes here.", to: "Our own words." }]);
  });
  it("copes with an added piece of text", () => {
    const { changes } = pairTextChanges("<h1>One</h1><p>Two</p>", "<h1>Uno</h1><p>Two</p><p>Extra</p>");
    expect(changes).toEqual([{ from: "One", to: "Uno" }]);
  });
  it("ties a repeated text that became two different things to its own occurrence", () => {
    const { changes, skipped } = pairTextChanges("<a>More</a><a>More</a>", "<a>Mehr</a><a>Plus</a>");
    expect(changes).toEqual([{ from: "More", to: "Mehr", nth: 0, of: 2 }, { from: "More", to: "Plus", nth: 1, of: 2 }]);
    expect(skipped).toBe(0);
  });
  it("changes a repeated text only where it was changed", () => {
    const { changes } = pairTextChanges("<a>Learn more</a><p>x</p><a>Learn more</a><a>Learn more</a>", "<a>Learn more</a><p>x</p><a>Find out more</a><a>Learn more</a>");
    expect(changes).toEqual([{ from: "Learn more", to: "Find out more", nth: 1, of: 3 }]);
  });
  it("pairs changed stretches of different length by how alike they read", () => {
    const { changes, skipped } = pairTextChanges("<h1>Strength starts here</h1><p>Open daily until late</p><b>Join</b>", "<h1>Strength starts at Aria</h1><p>Brand new line</p><p>Open daily until late tonight</p><b>Join</b>");
    expect(changes).toEqual([{ from: "Strength starts here", to: "Strength starts at Aria" }, { from: "Open daily until late", to: "Open daily until late tonight" }]);
    expect(skipped).toBe(1);
  });
  it("sees a sentence split by inline tags as one run, and the pieces inside it", () => {
    const runs = visibleRuns("<h1>Build <em>strong</em> habits</h1><p>Plain</p>");
    expect(runs).toEqual([{ text: "Build strong habits", nodes: ["Build", "strong", "habits"] }, { text: "Plain", nodes: ["Plain"] }]);
    const { changes } = pairTextChanges("<h1>Build <em>strong</em> habits</h1>", "<h1>Build <em>lasting</em> habits</h1>");
    expect(changes).toEqual([{ from: "Build strong habits", to: "Build lasting habits", parts: [{ from: "strong", to: "lasting" }] }]);
  });
  it("sees changed alt text and placeholders", () => {
    const { changes } = pairTextChanges('<img alt="Gym floor"><input placeholder="Your email">', '<img alt="Aria studio floor"><input placeholder="Your email">');
    expect(changes).toEqual([{ from: "Gym floor", to: "Aria studio floor" }]);
  });
  it("sees swapped pictures and a new title", () => {
    expect(pairImageChanges('<img src="a.jpg"><img src="b.jpg">', '<img src="a.jpg"><img src="c.jpg">')).toEqual([{ from: "b.jpg", to: "c.jpg" }]);
    expect(pairImageChanges('<img src="a.jpg">', '<img src="a.jpg"><img src="c.jpg">')).toEqual([]);
    expect(metaChanges(page, page.replace("<title>Iron &amp; Grain</title>", "<title>Aria</title>"))).toEqual({ htmlTitle: "Aria" });
  });
});

type El = { id: string; type: string; props: Record<string, string> };
const design = () => ({
  format: "plexo-v2@1",
  pages: [{ id: "p1", name: "Home", elements: [
    { id: "e1", type: "heading", props: { text: "Iron & Grain" } },
    { id: "e2", type: "text", props: { text: "Train with coaches who care about your progress every single week." } },
    { id: "e3", type: "richtext", props: { html: "<p>Welcome to Iron &amp; Grain, the gym.</p><p>Open daily</p>", color: "#e0b040", shade: "#b08a28" } },
    { id: "e4", type: "image", props: { src: "https://x/b.jpg", alt: "Join" } },
  ] as El[] }],
  meta: { htmlTitle: "Iron & Grain" },
});

describe("syncing design data", () => {
  const original = `<html><head><title>Iron &amp; Grain</title><style>.btn{background:#e0b040}</style></head><body><h1>Iron &amp; Grain</h1><p>Train with coaches who care about your progress every single week.</p><p>Welcome to Iron &amp; Grain, the gym.</p><p>Open daily</p><img src="https://x/b.jpg"></body></html>`;
  const final = brandPreviewHtml(original, { name: "Aria", designName: "Iron & Grain: gym", color: "#2255ee", about: ABOUT }).replace("https://x/b.jpg", "https://x/c.jpg");

  it("carries the owner's name, words, picture and colour into the design data", () => {
    const { design: out, report } = syncDesignData(design(), { originalHtml: original, finalHtml: final, accent: { from: "#e0b040", to: "#2255ee" } });
    const els = out.pages[0].elements;
    expect(els[0].props.text).toBe("Aria");
    expect(els[1].props.text).toBe(ABOUT);
    expect(els[2].props.html).toBe("<p>Welcome to Aria, the gym.</p><p>Open daily</p>");
    expect(els[2].props.color).toBe("#2255ee");
    expect(els[2].props.shade).not.toBe("#b08a28");
    expect(els[3].props.src).toBe("https://x/c.jpg");
    expect(out.meta.htmlTitle).toBe("Aria");
    expect(report.problems).toEqual([]);
    expect(report.imagesApplied).toBe(1);
    // ids and types are never touched, and the input is not modified
    expect(els[0].id).toBe("e1");
    expect(design().pages[0].elements[0].props.text).toBe("Iron & Grain");
  });

  it("reports text it could not find instead of failing", () => {
    const { report } = syncDesignData({ format: "plexo-v2@1", pages: [{ id: "p", elements: [] }] }, { originalHtml: original, finalHtml: final });
    expect(report.textChanges).toBeGreaterThan(0);
    expect(report.textsApplied).toBe(0);
    expect(report.unmatched.length).toBe(report.textChanges);
    expect(report.problems.join(" ")).toContain("couldn't be filled in automatically");
    expect(report.problems.join(" ")).toContain("Review and edit your pages");
  });

  it("leaves everything alone when nothing changed", () => {
    const { design: out, report } = syncDesignData(design(), { originalHtml: original, finalHtml: original });
    expect(out).toEqual(design());
    expect(report.textChanges).toBe(0);
  });
});
