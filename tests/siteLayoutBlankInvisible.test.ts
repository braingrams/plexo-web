import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/contentEntities", () => ({ Template: {}, BlogSite: {}, SiteLayout: {}, PublishedDomain: {} }));
vi.mock("@/lib/db/commerceEntities", () => ({ CommerceSettings: {} }));

import { layoutSectionsOf, spliceLayoutRows, applyPageChrome } from "@/lib/siteLayoutCore";
import { compileV2Design, spliceLayoutSections } from "@/lib/v2/compile";
import { buildV2Page } from "@/lib/v2/layoutDesigns";

const page = buildV2Page("Home", "home", [
  { op: "addSection", kind: "header", id: "sec-header", variant: "classic", content: { brand: "Acme", logo: "", links: [{ label: "Home", href: "/" }], cta: { label: "", href: "" } } },
  { op: "addSection", kind: "hero", id: "sec-hero" },
]);
const ctx = { rootTemplateId: "root", pageTemplateId: "p1", name: "Home" };

const blankV2 = { designFormat: "v2", designJson: buildV2Page("Site Header", "site-header", []) };
const blankV1 = { designFormat: undefined, designJson: { body: { style: {}, rows: [] } } };

describe("a blank header/footer is invisible", () => {
  it("a blank new-editor fragment contributes no sections", () => {
    const sections = layoutSectionsOf({ headerRows: [], footerRows: [], headerSource: blankV2, footerSource: blankV2 });
    expect(sections).toEqual({ headerSections: [], footerSections: [] });
  });
  it("a blank classic fragment contributes no sections or rows", () => {
    expect(layoutSectionsOf({ headerRows: [], footerRows: [], headerSource: blankV1, footerSource: blankV1 })).toEqual({ headerSections: [], footerSections: [] });
    const design = { body: { rows: [{ id: "r" }] } };
    expect(spliceLayoutRows(design, { headerRows: [], footerRows: [] })).toBe(design);
  });
  it("splicing nothing returns the same design object", () => {
    expect(spliceLayoutSections(page, { headerSections: [], footerSections: [] })).toBe(page);
  });
  it("the served page is byte-for-byte the same with a blank layout as with none", () => {
    const withNone = compileV2Design(page, ctx);
    const sections = layoutSectionsOf({ headerRows: [], footerRows: [], headerSource: blankV2, footerSource: blankV2 });
    expect(compileV2Design(page, { ...ctx, layout: sections })).toBe(withNone);
    expect(withNone).toContain("Acme"); // the page's own menu is still what shows
  });
  it("a real header does change the page (the owner's opt-in is what makes the difference)", () => {
    const real = { designFormat: "v2", designJson: buildV2Page("Site Header", "site-header", [{ op: "addSection", kind: "header", id: "sec-header", variant: "classic", content: { brand: "Shared Brand", logo: "", links: [{ label: "Home", href: "/" }], cta: { label: "", href: "" } } }]) };
    const html = compileV2Design(page, { ...ctx, layout: layoutSectionsOf({ headerRows: [], footerRows: [], headerSource: real, footerSource: blankV2 }) });
    expect(html).toContain("Shared Brand");
  });
  it("per-page switches on a blank layout change nothing either", () => {
    const layout = { headerRows: [], footerRows: [], headerSource: blankV2, footerSource: blankV2 };
    expect(applyPageChrome(layout, { hideHeader: true })).toMatchObject({ headerRows: [], headerSource: null });
    expect(layoutSectionsOf(applyPageChrome(layout, { hideHeader: true, hideFooter: true }))).toEqual({ headerSections: [], footerSections: [] });
  });
});
