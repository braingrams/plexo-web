import { describe, expect, it } from "vitest";
import { injectBrandingBar } from "@/lib/pub/htmlInject";

describe("the Hosted with Plexo bar", () => {
  const out = injectBrandingBar("<html><body><p>x</p></body></html>", "https://plexo.charisol.io/?utm_source=branding_bar#pricing");

  it("uses the new brand and Plexo's logo, with the word shown until the logo loads", () => {
    expect(out).toContain("#b8f34a");
    expect(out).not.toMatch(/#8b5cf6|#7c3aed/i);
    expect(out).toContain('src="https://plexo.charisol.io/api/brand/logo/wordmark-on-dark"');
    expect(out).toMatch(/<strong>Plexo<\/strong><img [^>]*style="display:none/);
    expect(out).toContain("onload=");
    expect(out.indexOf("Host yours now")).toBeLessThan(out.indexOf("</body>"));
  });

  it("falls back to Plexo's own address when the link is local", () => {
    expect(injectBrandingBar("<body></body>", "http://localhost:3000/?x")).toContain("https://plexo.charisol.io/api/brand/logo/wordmark-on-dark");
  });
});
