import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";

vi.mock("next/font/google", () => ({
  Figtree: () => ({ variable: "--font-figtree" }),
}));

vi.mock("geist/font/mono", () => ({
  GeistMono: { variable: "--font-geist-mono" },
}));

describe("Facebook Domain Verification", () => {
  it("root layout includes facebook-domain-verification meta tag", async () => {
    const layout = await import("@/app/layout");
    expect(layout.metadata.verification).toBeDefined();
    const other = layout.metadata.verification?.other as Record<string, string> | undefined;
    expect(other?.["facebook-domain-verification"]).toBe("e4tne2gkh4krjhyp11ybuucqkt9s9g");
  });

  it("middleware bare apex redirect contains facebook-domain-verification in head HTML", () => {
    const middlewareContent = fs.readFileSync(path.resolve(process.cwd(), "middleware.ts"), "utf-8");
    expect(middlewareContent).toContain(
      '<meta name="facebook-domain-verification" content="e4tne2gkh4krjhyp11ybuucqkt9s9g"/>'
    );
  });
});
