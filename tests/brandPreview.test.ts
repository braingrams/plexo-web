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
  it("uses brand variables when the design is built on them", () => {
    const html = `<html><head><style>:where(:root){--color-brand-primary-500:#e0b040}.b{background:var(--color-brand-primary-500)}</style></head><body>x</body></html>`;
    const out = brandPreviewHtml(html, { color: "#2255ee" });
    expect(out).toContain("#e0b040}"); // original fallback kept
    expect(out).toContain(":root{--color-brand-primary-500:#2255ee");
  });
});

import { salvageReplacements } from "@/lib/onboarding/solPersonalize";
describe("salvageReplacements", () => {
  it("keeps the finished entries of a cut-off reply", () => {
    expect(salvageReplacements('{"r": {"1": "Hello \\"you\\"", "2": "Second", "3": "Thi')).toEqual({ "1": 'Hello "you"', "2": "Second" });
  });
});
