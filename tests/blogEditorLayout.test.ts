import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("blog post editor layout", () => {
  const root = process.cwd();
  const editor = fs.readFileSync(path.join(root, "app/dashboard/templates/[id]/blog/BlogPostEditor.tsx"), "utf8");
  const css = fs.readFileSync(path.join(root, "app/globals.css"), "utf8");

  it("the editor's root also carries .plx-page (a flex column), so its grid is spelled out with both classes and wins whatever the stylesheet order", () => {
    expect(editor).toContain('className="plx-page blog-editor-grid"');
    // Same specificity as .plx-page (v3.css): without the two-class rule the sidebar drops under the editor.
    expect(css).toMatch(/\.plx-page:where\(:not\(\[data-plx-canvas\] \*\)\)\.blog-editor-grid\s*\{[^}]*display:\s*grid/);
    expect(css).toMatch(/@media \(max-width: 860px\)\s*\{[^}]*\.plx-page:where\(:not\(\[data-plx-canvas\] \*\)\)\.blog-editor-grid\s*\{[^}]*minmax\(0, 1fr\)/);
  });
});
