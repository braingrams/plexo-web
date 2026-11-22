import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACTIVITY_KINDS, seeAllHref, senderOf } from "@/lib/dashboardV3/seeAllLinks";
import { HUB_TAB_IDS, hubTabs, parseHubTab, hubTabHref, type HubFeatures, NO_FEATURES } from "@/lib/dashboardV3/hubTabs";
import { advancedSections, parseAdvancedSection, advancedKind } from "@/lib/dashboardV3/hubAdvanced";

const SITE = "s1";
const store: HubFeatures = { ...NO_FEATURES, store: true };
const course: HubFeatures = { ...NO_FEATURES, course: true };

describe("Home 'See all' links", () => {
  it("each card opens its own list, never the bare site page", () => {
    expect(seeAllHref("orders", SITE)).toBe("/dashboard/sites/s1?tab=orders");
    expect(seeAllHref("students", SITE)).toBe("/dashboard/sites/s1?tab=course");
    expect(seeAllHref("messages", SITE, "beginner")).toBe("/dashboard/templates/s1/form-submissions");
    expect(seeAllHref("messages", SITE, "pro")).toBe("/dashboard/sites/s1?tab=advanced&section=forms");
    expect(seeAllHref("none", SITE)).toBeNull();
    for (const kind of ACTIVITY_KINDS) expect(seeAllHref(kind, SITE)).not.toBe(`/dashboard/sites/${SITE}`);
  });

  it("every hub-tab destination exists for a site that has what the card lists", () => {
    const needs = { orders: store, students: course } as const;
    for (const [kind, features] of Object.entries(needs)) {
      for (const exp of ["beginner", "pro"] as const) {
        const href = seeAllHref(kind as "orders" | "students", SITE, exp)!;
        const tab = parseHubTab(new URL(href, "https://x").searchParams.get("tab"));
        expect(tab, href).not.toBeNull();
        expect(hubTabs(features, exp).map((t) => t.id)).toContain(tab);
      }
    }
  });

  it("the pro forms link points at a real Advanced section", () => {
    const href = new URL(seeAllHref("messages", SITE, "pro")!, "https://x");
    expect(href.searchParams.get("tab")).toBe("advanced");
    const id = parseAdvancedSection(href.searchParams.get("section"));
    expect(id).toBe("forms");
    expect(advancedSections({ kind: advancedKind(NO_FEATURES), experience: "pro" }).map((s) => s.id)).toContain(id);
  });

  it("every hub tab address round-trips through ?tab=", () => {
    for (const id of HUB_TAB_IDS) {
      const href = hubTabHref(SITE, id);
      const tab = new URL(href, "https://x").searchParams.get("tab") ?? "pages";
      expect(tab).toBe(id);
    }
  });

  it("no Home card links a 'See all' / 'View all' to the bare site page", () => {
    const dir = join(process.cwd(), "app/dashboard/_v3/home");
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".tsx"))) {
      const src = readFileSync(join(dir, f), "utf8");
      for (const line of src.split("\n")) {
        if (/See all|View all/.test(line)) expect(line, `${f}: ${line.trim()}`).not.toMatch(/href=\{`\/dashboard\/sites\/\$\{[^}]+\}`\}/);
      }
    }
  });
});

describe("who a message is from", () => {
  it("prefers a name, then an email, then the form name", () => {
    expect(senderOf({ email: "a@b.co", Name: "Ada" })).toBe("Ada");
    expect(senderOf({ email: "a@b.co" })).toBe("a@b.co");
    expect(senderOf({ q: 1 }, "Contact")).toBe("Contact");
    expect(senderOf(null)).toBe("Someone");
    expect(senderOf(JSON.stringify({ email: "json@b.co", name: "Grace" }))).toBe("Grace");
    expect(senderOf({ first_name: "Ada", last_name: "Lovelace" })).toBe("Ada Lovelace");
  });
});
