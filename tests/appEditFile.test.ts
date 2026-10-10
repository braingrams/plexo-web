import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  for (const t of ["CORE", "LEDGER", "COMMERCE", "CONTENT", "OPS", "IMPORT", "SOL"]) process.env[`PLEXO_${t}_TABLE`] = `test-${t.toLowerCase()}`;
});

import { applyEdits } from "@/lib/projects/fileStore";

// SOL's app_edit_file missed on staging (indentation / remembered text), then fell back to
// rewriting whole files — paid rounds each. Near misses now apply; real misses show the lines.

const file = [
  "export function Hero() {",
  "  return (",
  '    <section className="hero">',
  "      <p>Unlocked with a single ~$49 payment.</p>",
  '      <a className="cta">Get lifetime access</a>',
  "    </section>",
  "  );",
  "}",
  "",
].join("\n");

describe("editing part of an app file", () => {
  it("applies an exact match", () => {
    expect(applyEdits(file, [{ find: "~$49", replace: "$49" }], "src/Hero.tsx")).toContain("single $49 payment");
  });

  it("applies a match that's only off in indentation and spacing", () => {
    const find = ["<p>Unlocked with a single ~$49 payment.</p>", '<a  className="cta">Get lifetime access</a>'].join("\n");
    const replace = ["      <p>One payment.</p>", '      <a className="cta">Buy</a>'].join("\n");
    const out = applyEdits(file, [{ find, replace }], "src/Hero.tsx");
    expect(out).toContain("<p>One payment.</p>");
    expect(out).not.toContain("Unlocked");
    expect(out).toContain("</section>");
  });

  it("still refuses an ambiguous loose match", () => {
    const twice = ["  <li>x</li>", "    <li>x</li>", ""].join("\n");
    expect(() => applyEdits(twice, [{ find: "<li>x</li> ", replace: "y" }], "a.tsx")).toThrow(/appears 2 times/);
  });

  it("shows the real lines, numbered, when the text isn't there", () => {
    let message = "";
    try {
      applyEdits(file, [{ find: '<a className="cta">Get access now</a>', replace: "x" }], "src/Hero.tsx");
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("closest part of the file");
    expect(message).toContain('5|       <a className="cta">Get lifetime access</a>');
  });

  it("replaces every occurrence with all: true", () => {
    expect(applyEdits("a b a", [{ find: "a", replace: "c", all: true }], "x.txt")).toBe("c b c");
  });
});
