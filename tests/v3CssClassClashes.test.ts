import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyze, format, walkCss } from "../scripts/css-class-clashes";

const root = process.cwd();
const v3 = path.join(root, "app/dashboard/_v3");

/**
 * Intentional shared bases: v3.css owns the base rules; other sections only add namespaced
 * modifiers (`.plx-card.plx-aside`, `.plx-sidebar[data-mode="sol"]`, `.plx-menu .plx-menu__bad`).
 * Do NOT add a class here just to silence the test; rename it with the section prefix instead.
 */
const SHARED_BASES = new Set(["plx-card", "plx-content", "plx-menu", "plx-sidebar"]);

describe("v3 dashboard stylesheets", () => {
  it("no class is styled by two different section stylesheets", () => {
    const files = walkCss(v3);
    const clashes = analyze(files).filter((c) => {
      if (!SHARED_BASES.has(c.cls)) return true;
      // a shared base must live in v3.css; other files may only add rules scoped by a second class/attribute
      // the editor-canvas guard (see customerPageIsolation.test.ts) is not a scoping class, so look past it
      const plain = (s: string) => s.split(":where(:not([data-plx-canvas] *))").join("");
      return c.uses.some((u) => path.basename(u.file) !== "v3.css" && u.selectors.some((raw) => { const s = plain(raw); return /^\.[\w-]+\s*(?:[a-z]|$|:|,)/i.test(s) && !/^\.[\w-]+(?:\.|\[|\s+\.)/.test(s); }));
    });
    const message =
      "These class names have rules in more than one CSS file. On a client navigation only some stylesheets are loaded, " +
      "but a hard reload loads all of them, so the sections restyle each other and pages look displaced after a reload. " +
      "Prefix section-specific class names with the section (hub plx-h*, settings plx-sp*/plx-st*, learners plx-l*, " +
      "migrate plx-mv*, emails plx-em*, sol plx-sol*, newsite plx-ns*, designs plx-dz*) in the CSS and every className use. " +
      "Shared bases belong only in v3.css (see SHARED_BASES in this test).\n\n" + format(clashes, root);
    expect(clashes, message).toEqual([]);
  });
});
