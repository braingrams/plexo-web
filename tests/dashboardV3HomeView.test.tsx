import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {}, prefetch: () => {} }), usePathname: () => "/dashboard" }));
import { HomeView } from "@/app/dashboard/_v3/home/HomeView";
import type { HomeProps, HomeSiteRow } from "@/app/dashboard/_v3/home/homeTypes";

const stats = { stats: [], activity: [], activityTitle: "", activityEmpty: "" } as unknown as HomeSiteRow["stats"];
const row = (id: string, name: string): HomeSiteRow => ({ site: { id, name, kind: "Website", status: "draft", address: null }, stats });
const base: Omit<HomeProps, "mode" | "site" | "all"> = { firstName: "Ada", experience: "pro", brand: {}, baseDomain: "plexopages.com", newSiteHref: "/dashboard/sites/new" };

describe("Home picks the right screen", () => {
  it("shows every site for 'all' mode (this carries no single site and must NOT look like 'no site yet')", () => {
    const html = renderToStaticMarkup(<HomeView {...base} mode="all" site={null} all={[row("a", "Aria"), row("b", "KayCare")]} />);
    expect(html).not.toContain("Look around");
    expect(html).not.toContain("Set up your first site");
    expect(html).toContain("Aria");
    expect(html).toContain("KayCare");
  });
  it("only people with no sites see the 'set up your first site' screen", () => {
    const html = renderToStaticMarkup(<HomeView {...base} mode="none" site={null} all={[]} />);
    expect(html).toContain("Look around");
    expect(html).toContain("/dashboard/sites/new");
  });
});
