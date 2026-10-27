import { describe, expect, it } from "vitest";
import { parseSync } from "vite";
import { planInstall, InstallPlanError } from "../src/installPlan";
import { sourceLocPlugin } from "../src/sourceLocPlugin";

const BASE = { react: "19.3.0", "react-dom": "19.3.0", vite: "8.3.4", "lucide-react": "1.54.0", "@tanstack/react-query": "5.104.1" };

describe("planInstall", () => {
  it("needs no install when every dependency is in the pre-installed set", () => {
    const pkg = JSON.stringify({ dependencies: { react: "^19.3.0", "lucide-react": "^1.0.0" }, devDependencies: { vite: "^8.0.0" } });
    expect(planInstall(pkg, BASE)).toEqual({ mode: "base" });
  });

  it("installs when a package is new or its range isn't satisfied, with a stable hash", () => {
    const a = planInstall(JSON.stringify({ dependencies: { react: "^19.3.0", dayjs: "^1.11.0" } }), BASE);
    const b = planInstall(JSON.stringify({ dependencies: { dayjs: "^1.11.0", react: "^19.3.0" } }), BASE);
    expect(a.mode).toBe("install");
    expect(a.mode !== "base" && b.mode !== "base" && a.depsHash === b.depsHash).toBe(true);
    expect(planInstall(JSON.stringify({ dependencies: { react: "^18.0.0" } }), BASE).mode).toBe("install");
  });

  it("treats latest/* as satisfied by the pre-installed version", () => {
    expect(planInstall(JSON.stringify({ dependencies: { react: "latest", vite: "*" } }), BASE)).toEqual({ mode: "base" });
  });

  it("rejects non-registry dependency specs and bad JSON with a fix", () => {
    expect(() => planInstall(JSON.stringify({ dependencies: { x: "github:evil/x" } }), BASE)).toThrow(InstallPlanError);
    expect(() => planInstall(JSON.stringify({ dependencies: { x: "file:../../etc" } }), BASE)).toThrow(/npm registry/);
    expect(() => planInstall("{ nope", BASE)).toThrow(/isn't valid JSON/);
    expect(() => planInstall(JSON.stringify({ dependencies: { "../x": "1.0.0" } }), BASE)).toThrow(/valid npm package name/);
  });
});

describe("sourceLocPlugin", () => {
  const plugin = sourceLocPlugin("/work/app", parseSync as any);

  it("tags DOM and component elements with file:line:col, before any props spread", () => {
    const code = [
      "export default function Page(props) {",
      "  return (",
      '    <main className="p-4">',
      "      <Button {...props}>Go</Button>",
      "    </main>",
      "  );",
      "}",
    ].join("\n");
    const out = plugin.transform(code, "/work/app/src/pages/Page.tsx") as { code: string; map: unknown };
    expect(out.code).toContain('<main data-plexo-loc="src/pages/Page.tsx:3:5" className="p-4">');
    expect(out.code).toContain('<Button data-plexo-loc="src/pages/Page.tsx:4:7" {...props}>');
    expect(out.map).toBeTruthy();
  });

  it("skips fragments, providers and files outside src/", () => {
    const code = 'export const A = () => <Ctx.Provider value={1}><React.Fragment><div /></React.Fragment></Ctx.Provider>;';
    const out = plugin.transform(code, "/work/app/src/a.tsx") as { code: string };
    expect(out.code).not.toMatch(/Provider data-plexo-loc/);
    expect(out.code).not.toMatch(/Fragment data-plexo-loc/);
    expect(out.code).toContain('<div data-plexo-loc="src/a.tsx:1:');
    expect(plugin.transform(code, "/work/app/node_modules/x/a.tsx")).toBeNull();
    expect(plugin.transform("export const x = 1 <", "/work/app/src/broken.tsx")).toBeNull();
  });
});
