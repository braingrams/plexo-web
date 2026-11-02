import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";

import { SDK_V2_ALL, SDK_V2_INSTALL } from "@/lib/sdk/v2-snippets";

// The copy-paste code on /sdk, /developers and the dashboard must really compile against the installed SDK.
// Each snippet is type-checked as a file of its own, with stand-ins for the app code it refers to.

const PRELUDE: Record<string, string> = {
  short: `declare function saveToMyDatabase(pages: unknown[]): Promise<void>;\n`,
  pages: `
declare const mySite: { pages: Array<{ id: string; title: string; path: string }> };
declare const current: import('@charisol/plexo-sdk/v2').PageDefinition | undefined;
declare const router: { push(url: string): void };
declare function createPage(name: string, templateId: string): void;
declare function renamePage(id: string, name: string): void;
declare function deletePage(id: string): void;
`,
  api: `declare const pages: unknown[]; declare const designSystem: unknown;\nexport {};\n`,
};

describe("SDK 2 docs snippets", () => {
  it("installs the package", () => {
    expect(SDK_V2_INSTALL).toContain("@charisol/plexo-sdk");
  });

  it("type-check against the installed SDK", () => {
    const root = process.cwd();
    const dir = mkdtempSync(join(root, ".snippet-check-"));
    try {
      mkdirSync(dir, { recursive: true });
      const ambient = join(dir, "ambient.d.ts");
      writeFileSync(ambient, "declare module '@/components/site-editor' { export const SiteEditor: () => null; }\n");
      const files = Object.entries(SDK_V2_ALL).map(([name, code]) => {
        const path = join(dir, `${name}.tsx`);
        // Snippets with imports are modules; the prelude declarations are appended after them.
        writeFileSync(path, `${code}\n${PRELUDE[name] ?? ""}\nexport {};\n`);
        return path;
      });
      const config = ts.readConfigFile(join(root, "tsconfig.json"), ts.sys.readFile);
      const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
      const program = ts.createProgram([...files, ambient], { ...parsed.options, noEmit: true, incremental: false, skipLibCheck: true });
      const problems = ts
        .getPreEmitDiagnostics(program)
        .filter((d) => d.file && files.includes(d.file.fileName))
        .map((d) => `${d.file!.fileName.split("/").pop()}: ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`);
      expect(problems).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
