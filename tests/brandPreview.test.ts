import { describe, expect, it } from "vitest";
import { brandPreviewHtml, dominantAccent, sampleBrandName } from "@/lib/onboarding/brandPreview";

const page = `<html><head><title>Iron &amp; Grain</title><style>.btn{background:#e0b040}.tag{color:#e0b040;border:1px solid #e0b040}body{background:#111111;color:#f4f1ea}</style></head><body><a class="logo">IRON &amp; GRAIN</a><h1>Welcome to Iron &amp; Grain</h1><button class="btn">Claim</button></body></html>`;

describe("brand preview", () => {
  it("finds the sample name from the design name", () => {
    expect(sampleBrandName("Iron & Grain: strength gym and coaching")).toBe("Iron & Grain");
    expect(sampleBrandName("")).toBeNull();
  });
  it("finds the accent colour, not greys", () => {
    expect(dominantAccent(page)).toBe("#e0b040");
  });
  it("puts the owner's name and colour on the design", () => {
    const out = brandPreviewHtml(page, { name: "Aria", color: "#2255ee", designName: "Iron & Grain: strength gym" });
    expect(out).toContain("ARIA");
    expect(out).toContain("Welcome to Aria");
    expect(out).not.toMatch(/iron/i);
    expect(out).not.toContain("#e0b040");
    expect(out).toContain("#2255ee");
    expect(out).toContain("--color-brand-primary-500:#2255ee");
  });
  it("leaves a design alone when there is nothing to apply", () => {
    expect(brandPreviewHtml(page, {})).toBe(page);
  });
  it("recolours a design built on brand variables too", () => {
    const html = `<html><head><style>:where(:root){--color-brand-primary-500:#e0b040}.b{background:var(--color-brand-primary-500)}</style></head><body>x</body></html>`;
    const out = brandPreviewHtml(html, { color: "#2255ee" });
    expect(out).not.toContain("#e0b040");
    expect(out).toContain(":root{--color-brand-primary-500:#2255ee");
  });
  it("finds the sample name when the page writes only its first word", () => {
    const html = `<html><head><style>.a{color:#c2410c}</style></head><body><a class="logo">Careline</a><h1>Care that comes to your door</h1><p>Careline looks after people.</p></body></html>`;
    const out = brandPreviewHtml(html, { name: "Aria", color: "#4f46e5", designName: "Careline Home Nursing: home care agency" });
    expect(out).toContain(">Aria<");
    expect(out).toContain("Aria looks after people");
    expect(out).not.toContain("Careline");
    expect(out).not.toContain("#c2410c");
  });
});

import { salvageReplacements } from "@/lib/onboarding/solPersonalize";
describe("salvageReplacements", () => {
  it("keeps the finished entries of a cut-off reply", () => {
    expect(salvageReplacements('{"r": {"1": "Hello \\"you\\"", "2": "Second", "3": "Thi')).toEqual({ "1": 'Hello "you"', "2": "Second" });
  });
});

describe("designs that write their name in a short form (real marketplace pages do)", () => {
  const page = (body: string, css = "") => `<html><head><style>${css}</style></head><body>${body}</body></html>`;

  it("swaps the full name and the short form everywhere, so the template's name is gone", () => {
    const html = page("<nav>Careline</nav><h1>Welcome</h1><p>Careline looks after people at home.</p><p>Every Careline carer is trained.</p><footer>Careline Home Nursing Ltd</footer>");
    const out = brandPreviewHtml(html, { name: "Zenith Hub", designName: "Careline Home Nursing: home care agency" });
    expect(out).not.toMatch(/Careline/);
    expect(out.match(/Zenith Hub/g)?.length).toBe(4);
  });

  it("swaps a two-word form the page uses alongside the full name", () => {
    const html = page("<nav>Harbour Mind</nav><p>Harbour Mind is a small practice.</p><footer>Harbour Mind Therapy Ltd</footer>");
    const out = brandPreviewHtml(html, { name: "Calm Co", designName: "Harbour Mind Therapy: counselling practice" });
    expect(out).not.toMatch(/Harbour/);
  });

  it("leaves a common first word alone when it is not clearly the brand", () => {
    const html = page("<nav>Little Sprouts</nav><h1>Little patients, big smiles.</h1><p>Little Sprouts is a clinic.</p>");
    const out = brandPreviewHtml(html, { name: "Zenith Hub", designName: "Little Sprouts Paediatrics: children's clinic" });
    expect(out).toContain("Little patients, big smiles.");
    expect(out).not.toMatch(/Little Sprouts/);
  });

  it("knows a brand that only starts a sentence when its address says so", () => {
    const html = page("<p>Marlowe told us what it would cost.</p><p>partners@marlowelaw.co.uk</p>");
    const out = brandPreviewHtml(html, { name: "Zenith Hub", designName: "Marlowe Law: modern law firm" });
    expect(out).toContain("Zenith Hub told us what it would cost.");
  });

  it("does not touch a longer word that merely starts with the name", () => {
    const html = page("<nav>Larch</nav><p>The old Larchhof barn, with larch-wood floors.</p>");
    const out = brandPreviewHtml(html, { name: "Zenith Hub", designName: "Larch: mountain hotel" });
    expect(out).toContain("Larchhof");
    expect(out).toContain("larch-wood");
  });

  it("moves the accent's darker and lighter shades to the owner's colour too", () => {
    const css = "a{color:#C9401B}.eyebrow{color:#A83315}.tint{background:#F7D9CF}.ink{color:#13284B}.cream{background:#FBF4E8}";
    const out = brandPreviewHtml(page("<a>x</a>", css), { name: "Zenith", color: "#7c3aed", designName: "X: y" });
    expect(out).not.toMatch(/#C9401B|#A83315|#F7D9CF/i);
    expect(out).toContain("#13284B");
    expect(out).toContain("#FBF4E8");
  });
});
