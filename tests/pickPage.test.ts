import { describe, expect, it } from "vitest";
import { buildPageChoices, searchPageChoices } from "@/lib/dashboardV3/pickPage";

const pages = [
  { id: "r", name: "Kharis Transport", slug: "", parentId: null },
  { id: "b", name: "Services", slug: "services", parentId: "r", order: 2 },
  { id: "a", name: "About", slug: "about", parentId: "r", order: 1 },
  { id: "c", name: "Fleet", slug: "fleet", parentId: "b", order: 0 },
];

describe("buildPageChoices", () => {
  it("calls the homepage Home and puts it first", () => {
    const out = buildPageChoices(pages, "r");
    expect(out[0]).toMatchObject({ label: "Home", path: "/", isHome: true, href: "/dashboard/templates/r" });
  });
  it("orders by the owner's arrangement with sub-pages under their parent", () => {
    expect(buildPageChoices(pages, "r").map((c) => c.id)).toEqual(["r", "a", "b", "c"]);
  });
  it("builds addresses and depth", () => {
    const fleet = buildPageChoices(pages, "r").find((c) => c.id === "c")!;
    expect(fleet).toMatchObject({ path: "/services/fleet", depth: 1 });
  });
  it("survives a cycle or orphan without looping", () => {
    expect(buildPageChoices([{ id: "r", name: "x" }, { id: "p", name: "p", parentId: "q" }, { id: "q", name: "q", parentId: "p" }], "r")).toHaveLength(1);
  });
});

describe("searchPageChoices", () => {
  const all = buildPageChoices(pages, "r");
  it("finds by name, address or the word home", () => {
    expect(searchPageChoices(all, "serv").map((c) => c.id)).toEqual(["b", "c"]);
    expect(searchPageChoices(all, "/fleet").map((c) => c.id)).toEqual(["c"]);
    expect(searchPageChoices(all, "home").map((c) => c.id)).toEqual(["r"]);
  });
  it("returns everything for an empty search", () => expect(searchPageChoices(all, "  ")).toHaveLength(4));
});
