import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

// Visual designs → app pages (lib/projects/designs.ts): saving compiles real React code,
// keeps routes.tsx and App.tsx wired, protects hand-edited code and keeps routes unique.

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

import { applyDesignSystem, saveDesign, listDesigns, getDesign, deleteDesign, wireDesignRoutes, renderRoutesFile, slugForName, normalizeRoute, DesignConflictError, DesignError } from "@/lib/projects/designs";
import { createDefaultDesignSystem } from "@charisol/plexo-sdk/v2/compile";

const SCAFFOLD_APP = readFileSync("lib/projects/scaffold/template/src/App.tsx", "utf8");
const OLD_APP = SCAFFOLD_APP.replace(/\nimport \{ designRoutes \}.*\n/, "\n").replace(/\n\s*\{designRoutes\.map[^\n]*/, "");

// A small hand-built page: a section holding a heading and a paragraph.
function samplePage(text = "Welcome home") {
  type TestNode = { id: string; type: string; name: string; styles: Record<string, unknown>; content?: string; children?: TestNode[] };
  const node = (id: string, type: string, extra: Partial<TestNode> = {}): TestNode => ({ id, type, name: id, styles: {}, ...extra });
  const rootNode = node("root", "page", {
    children: [
      node("sec", "section", {
        styles: { minHeight: "400px" },
        children: [node("h", "heading", { content: text, styles: { x: 40, y: 40, width: 500 } }), node("p", "paragraph", { content: "We build things.", styles: { x: 40, y: 120, width: 500 } })],
      }),
    ],
  });
  return { id: "x", name: "x", slug: "x", rootNode };
}
const input = (extra: Record<string, unknown> = {}) => ({ page: samplePage(), ...extra });

// The previous editor's document shape ("plexo-canvas@1").
function legacyDoc(extra: Record<string, unknown> = {}) {
  const n = (id: string, type: string, parentId: string | null, styles: Record<string, unknown>, props: Record<string, unknown>, children: string[] = []) => ({ id, type, parentId, children, styles, props });
  const nodes = Object.fromEntries(
    [
      n("s1", "Section", null, { height: 700, backgroundColor: "#0f172a" }, { name: "Hero" }, ["t1", "btn"]),
      n("t1", "Text", "s1", { x: 100, y: 60, width: 600, height: 80, fontSize: 48, fontWeight: 700, color: "#ffffff", htmlTag: "h1" }, { content: "Legacy welcome" }),
      n("btn", "Button", "s1", { x: 100, y: 230, width: 180, height: 48, backgroundColor: "#22c55e", color: "#052e16", borderRadius: 24 }, { label: "Get started", href: "https://example.com/start" }),
    ].map((x) => [x.id, x]),
  );
  return { format: "plexo-canvas@1", name: "Old home", route: "/", nodes, pageOrder: ["s1"], updatedAt: "2025-01-01T00:00:00.000Z", ...extra };
}

beforeEach(() => {
  files.clear();
  files.set("src/App.tsx", OLD_APP);
});

describe("designs", () => {
  it("the scaffold's empty routes.tsx is what Plexo generates, and the scaffold renders it", () => {
    expect(readFileSync("lib/projects/scaffold/template/src/plexo-canvas/routes.tsx", "utf8")).toBe(renderRoutesFile([]));
    expect(SCAFFOLD_APP).toBe(wireDesignRoutes(SCAFFOLD_APP));
    expect(OLD_APP).not.toContain("designRoutes");
  });

  it("wires design routes into an older App.tsx, first inside <Routes>, once", () => {
    const wired = wireDesignRoutes(OLD_APP)!;
    expect(wired).toContain('import { designRoutes } from "./plexo-canvas/routes";');
    expect(wired.indexOf("designRoutes.map")).toBeLessThan(wired.indexOf('path="/"'));
    expect(wireDesignRoutes(wired)).toBe(wired);
    expect(wireDesignRoutes("export default () => null;")).toBeNull();
  });

  it("saving compiles the page, stores it as plexo-canvas@2, writes routes and wires App.tsx", async () => {
    const result = await saveDesign("app1", "about", { name: "About us", route: "about/", ...input() });
    expect(result.routesWired).toBe(true);
    expect(result.design).toMatchObject({ slug: "about", route: "/about", codeFile: "src/plexo-canvas/AboutPage.tsx", codeEdited: false });
    const code = files.get("src/plexo-canvas/AboutPage.tsx")!;
    expect(code).toContain("export default function AboutPage()");
    expect(code).toContain("Welcome home");
    const stored = JSON.parse(files.get("src/plexo-canvas/about.canvas.json")!);
    expect(stored).toMatchObject({ format: "plexo-canvas@2", name: "About us", route: "/about" });
    expect(stored.page.type).toBe("page");
    expect(stored.nodes).toBeUndefined();
    expect(files.get("src/plexo-canvas/routes.tsx")).toContain('{ path: "/about", Component: AboutPage }');
    expect(files.get("src/App.tsx")).toContain("designRoutes.map");
    expect(files.has("src/plexo-canvas/brand.json")).toBe(false);
    expect((await listDesigns("app1")).designs.map((d) => d.slug)).toEqual(["about"]);
    const loaded = await getDesign("app1", "about");
    expect(loaded?.page).toMatchObject({ id: "about", slug: "about", name: "About us" });
    expect(loaded?.page.rootNode.children?.length).toBeGreaterThan(0);
  });

  it("uses the built-in design system until one is stored, and stores it on the first save", async () => {
    expect((await listDesigns("app1")).designSystem).toEqual(createDefaultDesignSystem());
    await saveDesign("app1", "home", { name: "Home", route: "/", ...input() });
    expect(JSON.parse(files.get("src/plexo-canvas/design-system.json")!)).toEqual(createDefaultDesignSystem());
  });

  it("leaves an old brand.json alone and ignores it", async () => {
    files.set("src/plexo-canvas/brand.json", '{"colors":[]}');
    await saveDesign("app1", "home", { name: "Home", route: "/", ...input() });
    expect(files.get("src/plexo-canvas/brand.json")).toBe('{"colors":[]}');
    expect((await listDesigns("app1")).designSystem).toEqual(createDefaultDesignSystem());
  });

  it("repairs a stored design system when reading it", async () => {
    const ds = createDefaultDesignSystem();
    files.set("src/plexo-canvas/design-system.json", JSON.stringify({ ...ds, tokens: [...ds.tokens, ds.tokens[0]] }));
    const { designSystem } = await listDesigns("app1");
    expect(designSystem.tokens.length).toBe(ds.tokens.length);
  });

  it("asks before replacing hand-edited page code, and replaces it when told to", async () => {
    await saveDesign("app1", "home", { name: "Home", route: "/", ...input() });
    files.set("src/plexo-canvas/HomePage.tsx", "export default function HomePage() { return <p>mine</p>; }");
    expect((await listDesigns("app1")).designs[0].codeEdited).toBe(true);
    await expect(saveDesign("app1", "home", { name: "Home", route: "/", ...input() })).rejects.toBeInstanceOf(DesignConflictError);
    await saveDesign("app1", "home", { name: "Home", route: "/", ...input(), overwrite: true });
    expect(files.get("src/plexo-canvas/HomePage.tsx")).toContain("Generated by Plexo");
  });

  it("keeps page addresses unique", async () => {
    await saveDesign("app1", "home", { name: "Home", route: "/", ...input() });
    await expect(saveDesign("app1", "landing", { name: "Landing", route: "/", ...input() })).rejects.toMatchObject({ code: "route_taken" });
  });

  it("a design-system change restyles other designs, except hand-edited ones", async () => {
    await saveDesign("app1", "a", { name: "A", route: "/a", ...input() });
    await saveDesign("app1", "b", { name: "B", route: "/b", ...input() });
    files.set("src/plexo-canvas/BPage.tsx", "// mine");
    const changed = createDefaultDesignSystem();
    changed.name = "Renamed brand";
    changed.tokens = changed.tokens.map((t, i) => (i === 0 ? { ...t, value: t.type === "color" ? "#123456" : t.value } : t));
    changed.tokens.push({ key: "--color-extra", name: "Extra", value: "#ff0000", type: "color", unit: null, layer: "brand", comment: null });
    const result = await saveDesign("app1", "c", { name: "C", route: "/c", ...input(), designSystem: changed });
    expect(result.recompiled).toEqual(["A"]);
    expect(result.skipped).toEqual(["B"]);
    expect(files.get("src/plexo-canvas/BPage.tsx")).toBe("// mine");
    expect(JSON.parse(files.get("src/plexo-canvas/design-system.json")!).tokens.some((t: { key: string }) => t.key === "--color-extra")).toBe(true);
    // Saving again with the same design system recompiles nothing.
    const again = await saveDesign("app1", "c", { name: "C", route: "/c", ...input(), designSystem: changed });
    expect(again.recompiled).toEqual([]);
    expect(again.skipped).toEqual([]);
  });

  it("deleting removes the page and its route", async () => {
    await saveDesign("app1", "about", { name: "About", route: "/about", ...input() });
    await deleteDesign("app1", "about");
    expect(files.has("src/plexo-canvas/AboutPage.tsx")).toBe(false);
    expect(files.get("src/plexo-canvas/routes.tsx")).toBe(renderRoutesFile([]));
  });

  it("rejects bad input with plain-language errors", async () => {
    expect(() => normalizeRoute("/a b")).toThrow(DesignError);
    expect(normalizeRoute("pricing//plans/")).toBe("/pricing/plans");
    await expect(saveDesign("app1", "../x", { name: "x", route: "/x", ...input() })).rejects.toBeInstanceOf(DesignError);
    await expect(saveDesign("app1", "x", { name: "x", route: "/x", page: null })).rejects.toThrow(/missing its content/);
    expect(slugForName("Routes")).toBe("routes-page");
    expect(slugForName("About us!", ["about-us"])).toBe("about-us-2");
  });

  it("rejects an invalid page with the SDK's plain message and writes nothing", async () => {
    const bad = samplePage();
    bad.rootNode.children![0].type = "marquee";
    await expect(saveDesign("app1", "x", { name: "x", route: "/x", page: bad })).rejects.toThrow(/This design can't be opened/);
    const dup = samplePage();
    (dup.rootNode.children![0].children![1]).id = "h";
    await expect(saveDesign("app1", "x", { name: "x", route: "/x", page: dup })).rejects.toThrow(/share the same id/);
    await expect(saveDesign("app1", "x", { name: "x", route: "/x", ...input({ designSystem: { nope: true } }) })).rejects.toThrow(/design system couldn't be read/);
    expect([...files.keys()]).toEqual(["src/App.tsx"]);
  });

  describe("designs saved by the previous editor (plexo-canvas@1)", () => {
    const seedLegacy = () => files.set("src/plexo-canvas/home.canvas.json", JSON.stringify(legacyDoc()));

    it("opens, upgraded to the new shape with its content intact", async () => {
      seedLegacy();
      const listed = await listDesigns("app1");
      expect(listed.designs).toMatchObject([{ slug: "home", name: "Old home", route: "/" }]);
      const loaded = (await getDesign("app1", "home"))!;
      expect(loaded.page).toMatchObject({ id: "home", slug: "home", name: "Old home", isHome: true });
      expect(JSON.stringify(loaded.page.rootNode)).toContain("Legacy welcome");
      expect(JSON.stringify(loaded.page.rootNode)).toContain("Get started");
      // Reading doesn't rewrite the file.
      expect(JSON.parse(files.get("src/plexo-canvas/home.canvas.json")!).format).toBe("plexo-canvas@1");
    });

    it("is rewritten as @2 on the next save, and still compiles", async () => {
      seedLegacy();
      const { page } = (await getDesign("app1", "home"))!;
      await saveDesign("app1", "home", { name: "Old home", route: "/", page });
      const stored = JSON.parse(files.get("src/plexo-canvas/home.canvas.json")!);
      expect(stored.format).toBe("plexo-canvas@2");
      expect(stored.nodes).toBeUndefined();
      expect(files.get("src/plexo-canvas/HomePage.tsx")).toContain("Legacy welcome");
    });

    it("still tells hand-edited code apart, and is recompiled by a design-system change", async () => {
      const code = "// compiled by the old editor";
      files.set("src/plexo-canvas/HomePage.tsx", code);
      files.set("src/plexo-canvas/home.canvas.json", JSON.stringify(legacyDoc({ generatedSha: sha(code) })));
      expect((await listDesigns("app1")).designs[0].codeEdited).toBe(false);
      files.set("src/plexo-canvas/HomePage.tsx", "// edited");
      expect((await listDesigns("app1")).designs[0].codeEdited).toBe(true);
      files.set("src/plexo-canvas/HomePage.tsx", code);
      const changed = { ...createDefaultDesignSystem(), name: "New look" };
      const result = await saveDesign("app1", "about", { name: "About", route: "/about", ...input(), designSystem: changed });
      expect(result.recompiled).toEqual(["Old home"]);
      expect(files.get("src/plexo-canvas/HomePage.tsx")).toContain("Legacy welcome");
    });
  });
});

describe("applyDesignSystem (Strata auto-update)", () => {
  it("stores the system, recompiles every design and skips pages edited in code", async () => {
    await saveDesign("app1", "home", { name: "Home", route: "/", ...input() });
    await saveDesign("app1", "about", { name: "About us", route: "/about", ...input() });
    files.set("src/plexo-canvas/AboutPage.tsx", `${files.get("src/plexo-canvas/AboutPage.tsx")}\n// hand edit`);
    const system = createDefaultDesignSystem();
    system.tokens = system.tokens.map((t, i) => (i === 0 ? { ...t, value: "#123456" } : t));
    const before = files.get("src/plexo-canvas/HomePage.tsx");
    const result = await applyDesignSystem("app1", system);
    expect(result).toEqual({ recompiled: ["Home"], skipped: ["About us"] });
    expect(JSON.parse(files.get("src/plexo-canvas/design-system.json")!).tokens[0].value).toBe("#123456");
    expect(files.get("src/plexo-canvas/AboutPage.tsx")).toContain("// hand edit");
    expect(files.get("src/plexo-canvas/HomePage.tsx")).toBeDefined();
    expect(before).toBeDefined();
    // Recompiled pages are no longer "edited in code".
    expect((await listDesigns("app1")).designs.find((d) => d.slug === "home")?.codeEdited).toBe(false);
  });
});

