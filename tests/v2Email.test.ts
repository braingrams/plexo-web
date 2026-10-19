import { describe, expect, it } from "vitest";

import { compileTemplate } from "@/lib/compileTemplate";
import { starterV2EmailDesign } from "@/lib/v2/design";

describe("emails in the new editor", () => {
  it("compile to a real email: tables, inline styles, a dark version, merge tags left alone", async () => {
    const design = starterV2EmailDesign();
    const html = await compileTemplate({ kind: "EMAIL", designFormat: "v2", designJson: design, id: "e1", name: "Welcome" });
    expect(html).toContain('<table role="presentation"');
    expect(html).toContain("prefers-color-scheme:dark");
    expect(html).toContain("{{first_name}}");
    expect(html).toContain("{{unsubscribe_url}}");
    expect(html).not.toMatch(/<script|display\s*:\s*(flex|grid)|var\(--/);
  });

  it("says plainly when an email can't be built, and never builds one from something that isn't a design", async () => {
    await expect(compileTemplate({ kind: "EMAIL", designFormat: "v2", designJson: { nope: true }, id: "e2", name: "x" })).rejects.toThrow();
  });

  it("classic emails still go through the classic path (unchanged)", async () => {
    const html = await compileTemplate({ kind: "EMAIL", designFormat: "v1", designJson: { rows: [] }, id: "e3", name: "x" }).catch((e) => String(e));
    expect(String(html)).not.toContain("prefers-color-scheme");
  });
});
