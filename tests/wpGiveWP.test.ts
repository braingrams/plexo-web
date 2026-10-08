import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { convertGiveForms, parseGiveFormView } from "@/lib/wpMigration/givewp";

// Real GiveWP 4.18 output (trimmed): a classic option-based form, a visual-builder
// campaign form's embed, and that form's iframe page.
const fixture = (name: string) => readFileSync(path.join(process.cwd(), "tests/fixtures", name), "utf8");

describe("GiveWP forms → Plexo Donations", () => {
  it("a classic form's levels, default, custom amount, minimum and currency come from its markup", async () => {
    const { html, forms } = await convertGiveForms(fixture("givewp-classic-form.html"), async () => null);
    expect(forms).toEqual([
      expect.objectContaining({
        source: "givewp:70",
        name: "Emergency Relief Fund",
        presets: [
          { label: "Supporter", amountMinor: 1000 },
          { label: "Friend", amountMinor: 2500 },
          { label: "Champion", amountMinor: 5000 },
        ],
        defaultPresetIndex: 1,
        allowCustomAmount: true,
        minAmountMinor: 500,
        allowMonthly: false,
        currency: "USD",
      }),
    ]);
    // GiveWP's form is gone; Plexo's donate form (a native block, not an adapted <form>) is in its place.
    expect(html).toContain(`<div class="plexo-donation" data-plexo-donation="${forms[0].token}"></div>`);
    expect(html).not.toContain("give-form-wrap");
    expect(html).toContain("<h1>Emergency Relief</h1>");
  });

  it("a visual-builder form's settings come from its iframe page", () => {
    expect(parseGiveFormView(fixture("givewp-form-view.html"))).toMatchObject({
      title: "School Supplies Drive",
      presets: [1000, 2500, 5000, 10000, 25000, 50000].map((amountMinor) => ({ amountMinor })),
      defaultPresetIndex: 0,
      allowCustomAmount: true,
      currency: "USD",
    });
  });

  it("the embed is replaced after fetching its form page (same site only — the caller checks)", async () => {
    const fetchView = vi.fn(async () => fixture("givewp-form-view.html"));
    const { html, forms } = await convertGiveForms(fixture("givewp-embed.html"), fetchView);
    expect(fetchView).toHaveBeenCalledWith(expect.stringMatching(/givewp-route=donation-form-view&form-id=67$/));
    expect(forms).toHaveLength(1);
    expect(forms[0]).toMatchObject({ source: "givewp:67", name: "School Supplies Drive" });
    expect(html).not.toMatch(/data-form-view-url|givewp-route/);
    expect(html).toContain("Support our school drive.");
  });

  it("an embed whose form page can't be read is left alone rather than guessed", async () => {
    const { html, forms } = await convertGiveForms(fixture("givewp-embed.html"), async () => null);
    expect(forms).toEqual([]);
    expect(html).toContain("data-form-view-url");
  });

  it("pages without GiveWP are untouched", async () => {
    const page = "<html><body><p>Hello</p></body></html>";
    expect(await convertGiveForms(page, async () => null)).toEqual({ html: page, forms: [] });
  });
});
