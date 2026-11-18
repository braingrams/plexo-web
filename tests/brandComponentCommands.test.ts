import { describe, expect, it } from "vitest";
import { applyCommands, createDefaultDesignSystem } from "@charisol/plexo-sdk/v2/compile";
import { newBrandComponents } from "@/lib/brand/brandComponents";
import { BRAND_COMPONENT_COMMANDS_READY } from "@/lib/brand/brandComponentCommands";


describe("brand component commands (SDK 2.0.33)", () => {
  it("are switched on", () => expect(BRAND_COMPONENT_COMMANDS_READY).toBe(true));

  it("saveAsBrandComponent adds exactly one new component, and the ones that were there stay the same objects", () => {
    const ds = createDefaultDesignSystem();
    const page = {
      id: "p1", name: "Home", slug: "home", rootNode: { id: "root", type: "page", name: "Home", children: [
        { id: "sec1", type: "section", name: "Offer", styles: { layoutMode: "flow", display: "flex", flexDirection: "column", backgroundColor: "#101820", textColor: "#ffffff" }, children: [
          { id: "h", type: "heading", name: "Heading", content: "Hello by hand", props: { level: 2 }, styles: { fontSize: "32px" } },
        ] },
      ] },
    };
    const out = applyCommands([page as never], ds, [{ op: "saveAsBrandComponent", nodeId: "h", name: "Offer card" }]);
    expect(out.results[0]?.ok).toBe(true);
    const added = newBrandComponents(ds.components, out.designSystem.components);
    expect(added).toHaveLength(1);
    expect(added[0]!.name).toBe("Offer card");
    expect(newBrandComponents(out.designSystem.components, out.designSystem.components)).toEqual([]);
  });

  it("an unknown brand component fails in plain words and adds nothing", () => {
    const ds = createDefaultDesignSystem();
    const page = { id: "p1", name: "Home", slug: "home", rootNode: { id: "root", type: "page", name: "Home", children: [{ id: "sec1", type: "section", name: "S", props: {}, styles: {}, children: [] }] } };
    const out = applyCommands([page as never], ds, [{ op: "insertBrandComponent", name: "Spaceship", variant: "default" }]);
    expect(out.results[0]?.ok).toBe(false);
    expect(out.results[0]?.message).toBeTruthy();
    expect(newBrandComponents(ds.components, out.designSystem.components)).toEqual([]);
  });
});
