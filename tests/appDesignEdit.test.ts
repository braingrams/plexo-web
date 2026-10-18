import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

// Page templates in the new-page flow, and SOL reading/editing designed pages
// (lib/projects/designTemplates.ts, lib/projects/designEdit.ts).

const files = new Map<string, string>();
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

vi.mock("@/lib/projects/fileStore", () => {
  class ProjectFileError extends Error {}
  return {
    ProjectFileError,
    listFiles: async () => [...files.entries()].map(([path, content]) => ({ path, sha: sha(content), size: content.length, contentType: "text/plain" })),
    readFiles: async (_id: string, paths: string[]) => ({
      files: paths.filter((p) => files.has(p)).map((p) => ({ path: p, content: files.get(p), size: 0, contentType: "text/plain" })),
      missing: paths.filter((p) => !files.has(p)),
    }),
    writeFiles: async (_id: string, writes: Array<{ path: string; content: string }>) => {
      for (const w of writes) files.set(w.path, w.content);
      return [];
    },
    deleteFiles: async (_id: string, paths: string[]) => {
      for (const p of paths) files.delete(p);
      return paths;
    },
  };
});
vi.mock("@/lib/projects/blobStore", () => ({ sha256: (s: string) => sha(s) }));

import { BLANK_TEMPLATE, defaultPageName, defaultRoute, freeRoute, pageFromTemplate, templates } from "@/lib/projects/designTemplates";
import { describeDesigns, editDesign } from "@/lib/projects/designEdit";
import { getAllDesigns, listDesigns, saveDesign } from "@/lib/projects/designs";
import { createDefaultDesignSystem, parsePages, type DocumentNode } from "@charisol/plexo-sdk/v2/compile";

const ds = createDefaultDesignSystem();
const ids = (n: DocumentNode): string[] => [n.id, ...(n.children ?? []).flatMap(ids)];

async function seedPage(slug: string, name: string, route: string, template = "about") {
  const page = pageFromTemplate(template, { name, slug, designSystem: ds })!;
  await saveDesign("app1", slug, { name, route, page });
}

beforeEach(() => {
  files.clear();
});

describe("page templates in the new-page flow", () => {
  it("offers every SDK template, with plain names", () => {
    expect(templates().map((t) => t.id)).toEqual(["blank", "home", "landing", "about", "services", "contact", "pricing"]);
    expect(defaultPageName("about")).toBe("About us");
    expect(defaultPageName(BLANK_TEMPLATE)).toBe("New page");
  });

  it("two pages from one template never share ids", () => {
    const a = pageFromTemplate("pricing", { name: "Pricing", slug: "pricing", designSystem: ds })!;
    const b = pageFromTemplate("pricing", { name: "Pricing 2", slug: "pricing-2", designSystem: ds })!;
    const idsA = new Set(ids(a.rootNode));
    expect(ids(b.rootNode).some((id) => idsA.has(id))).toBe(false);
    // and the same request gives the same page (safe to retry)
    expect(ids(pageFromTemplate("pricing", { name: "Pricing", slug: "pricing", designSystem: ds })!.rootNode)).toEqual(ids(a.rootNode));
  });

  it("blank opens the editor's own blank page", () => {
    expect(pageFromTemplate(BLANK_TEMPLATE, { name: "New page", slug: "new-page", designSystem: ds })).toBeUndefined();
  });

  it("template → address defaults, and a page the owner named is addressed by its name", () => {
    expect(defaultRoute("about", "About us")).toBe("/about");
    expect(defaultRoute("pricing", "Pricing")).toBe("/pricing");
    expect(defaultRoute("contact", "Contact")).toBe("/contact");
    expect(defaultRoute("home", "Home")).toBe("/");
    expect(defaultRoute("services", "Services")).toBe("/services");
    expect(defaultRoute("about", "Our team")).toBe("/our-team");
    expect(defaultRoute("blank", "New page")).toBe("/new-page");
  });

  it("never clashes with an existing address (a taken / becomes /home)", () => {
    expect(freeRoute(["/about"], "/about")).toBe("/about-2");
    expect(freeRoute(["/"], "/")).toBe("/home");
    expect(freeRoute(["/", "/home"], "/")).toBe("/home-2");
    expect(freeRoute([], "/pricing")).toBe("/pricing");
  });

  it("template pages (with hidden list-item keys and section blocks) pass the design validation and save", async () => {
    for (const t of templates().filter((t) => t.id !== BLANK_TEMPLATE)) {
      const page = pageFromTemplate(t.id, { name: t.name, slug: t.id, designSystem: ds })!;
      expect(JSON.stringify(page)).toContain('"_key"');
      expect(parsePages([page]).ok).toBe(true);
      await saveDesign("app1", t.id, { name: t.name, route: `/${t.id}`, page });
    }
    expect((await listDesigns("app1")).designs).toHaveLength(6);
  });
});

describe("app_design_describe", () => {
  it("lists each designed page with sections, plus the brand and the catalog", async () => {
    await seedPage("about", "About us", "/about");
    const out = await describeDesigns("app1");
    expect(out.pages).toHaveLength(1);
    expect(out.pages[0]).toMatchObject({ slug: "about", name: "About us", route: "/about", codeEdited: false });
    expect(out.pages[0].sections.length).toBeGreaterThan(3);
    expect(out.pages[0].sections[0]).toMatchObject({ kind: "header" });
    expect(out.catalog.kinds.length).toBeGreaterThan(5);
    expect(out.catalog.pageTemplates.map((t) => t.id)).toContain("pricing");
    expect(out.brand.neutrals).toBeTruthy();
  });

  it("says plainly when there are no designed pages", async () => {
    const out = await describeDesigns("app1");
    expect(out.pages).toEqual([]);
    expect(out.note).toMatch(/addPage/);
  });
});

describe("app_design_edit", () => {
  it("edits a section, saves, and regenerates the page code", async () => {
    await seedPage("about", "About us", "/about");
    const { pages } = await describeDesigns("app1");
    const hero = pages[0].sections.find((s) => s.kind === "hero")!;
    const out = await editDesign("app1", { slug: "about", commands: [{ op: "updateSection", sectionId: hero.id, content: { headline: "Hello from SOL" } }] });
    expect(out.ok).toBe(true);
    expect(out.results).toEqual([expect.objectContaining({ ok: true })]);
    expect(out.saved).toEqual([{ slug: "about", name: "About us", route: "/about" }]);
    expect(files.get("src/plexo-canvas/AboutPage.tsx")).toContain("Hello from SOL");
    expect((await listDesigns("app1")).designs[0].codeEdited).toBe(false);
  });

  it("an addSection without a pageId goes to the page being edited", async () => {
    await seedPage("about", "About us", "/about");
    const before = (await describeDesigns("app1")).pages[0].sections.length;
    const out = await editDesign("app1", { slug: "about", commands: [{ op: "addSection", kind: "faq" }] });
    expect(out.ok).toBe(true);
    expect((await describeDesigns("app1")).pages[0].sections.length).toBe(before + 1);
  });

  it("partial success: good commands are saved, bad ones explained", async () => {
    await seedPage("about", "About us", "/about");
    const { pages } = await describeDesigns("app1");
    const hero = pages[0].sections.find((s) => s.kind === "hero")!;
    const out = await editDesign("app1", {
      slug: "about",
      commands: [{ op: "updateSection", sectionId: hero.id, content: { headline: "Kept" } }, { op: "updateSection", sectionId: "nope", content: {} }, { op: "addSection", pageId: "about", kind: "teleporter" }],
    });
    expect(out.ok).toBe(true);
    expect(out.results.map((r) => r.ok)).toEqual([true, false, false]);
    expect(out.results[1].message).toMatch(/couldn't find a section/);
    expect(out.results[2].message).toMatch(/don't know a "teleporter"/);
    expect(files.get("src/plexo-canvas/AboutPage.tsx")).toContain("Kept");
  });

  it("saves nothing when every command fails", async () => {
    await seedPage("about", "About us", "/about");
    const stored = files.get("src/plexo-canvas/about.canvas.json");
    const out = await editDesign("app1", { slug: "about", commands: [{ op: "removeSection", sectionId: "nope" }] });
    expect(out.ok).toBe(false);
    expect(out.saved).toEqual([]);
    expect(files.get("src/plexo-canvas/about.canvas.json")).toBe(stored);
  });

  it("leaves a page edited in code alone, and explains", async () => {
    await seedPage("about", "About us", "/about");
    files.set("src/plexo-canvas/AboutPage.tsx", "export default function AboutPage() { return <p>mine</p>; }");
    const { pages } = await describeDesigns("app1");
    expect(pages[0].codeEdited).toBe(true);
    const out = await editDesign("app1", { slug: "about", commands: [{ op: "addSection", kind: "faq" }] });
    expect(out.ok).toBe(false);
    expect(out.notes[0]).toMatch(/edited in code/);
    expect(files.get("src/plexo-canvas/AboutPage.tsx")).toContain("mine");
    const forced = await editDesign("app1", { slug: "about", commands: [{ op: "addSection", kind: "faq" }], overwrite: true });
    expect(forced.ok).toBe(true);
    expect(files.get("src/plexo-canvas/AboutPage.tsx")).toContain("Generated by Plexo");
  });

  it("addPage with a template creates a complete page at its default address", async () => {
    await seedPage("home", "Home", "/", "home");
    const out = await editDesign("app1", { commands: [{ op: "addPage", name: "Pricing", templateId: "pricing" }, { op: "addPage", name: "Pricing", templateId: "pricing" }] });
    expect(out.ok).toBe(true);
    expect(out.results.map((r) => r.ok)).toEqual([true, false]);
    expect(out.saved).toEqual([{ slug: "pricing", name: "Pricing", route: "/pricing" }]);
    expect(files.get("src/plexo-canvas/routes.tsx")).toContain('path: "/pricing"');
    expect(files.get("src/plexo-canvas/PricingPage.tsx")).toContain("export default function PricingPage");
  });

  it("addPage works in an app with no designs yet, naming other pages by their own name", async () => {
    const out = await editDesign("app1", { commands: [{ op: "addPage", name: "Home", templateId: "home" }, { op: "addPage", name: "Start", templateId: "home" }] });
    expect(out.saved.map((s) => s.route)).toEqual(["/", "/start"]);
    expect((await getAllDesigns("app1")).designs).toHaveLength(2);
  });

  it("a brand change is saved and restyles the pages", async () => {
    await seedPage("about", "About us", "/about");
    const out = await editDesign("app1", { slug: "about", commands: [{ op: "setBrand", tokens: { primaryColor: "#B91C1C" } }] });
    expect(out.ok).toBe(true);
    expect(JSON.parse(files.get("src/plexo-canvas/design-system.json")!)).not.toEqual(ds);
  });

  it("explains unknown pages and empty requests in plain words", async () => {
    await seedPage("about", "About us", "/about");
    await expect(editDesign("app1", { slug: "nope", commands: [{ op: "addSection", kind: "faq" }] })).rejects.toThrow(/designed pages are: about/);
    await expect(editDesign("app1", { slug: "about", commands: [] })).rejects.toThrow(/at least one change/);
  });
});
