import { applyCommands, createDefaultDesignSystem, describeDesign, parseSolReply } from "@charisol/plexo-sdk/v2/compile";
import { describe, expect, it } from "vitest";

// A hand-built (premium template) hero, as SOL sees and changes it through the published SDK.
const pages = () => [{
  id: "p1", name: "Home", slug: "home", isHome: true,
  rootNode: { id: "root", type: "page", name: "Page", styles: {}, children: [{
    id: "hero", type: "section", name: "Opening", styles: {}, children: [{
      id: "grid", type: "container", name: "Hero grid", styles: { display: "grid", layoutMode: "grid", gridColumns: 2 }, children: [
        { id: "headline", type: "heading", name: "headline", content: "Find the home you will stay in.", props: { level: 1 }, styles: { fontSize: "64px" } },
        { id: "photo", type: "image", name: "photo", props: { src: "/a.jpg", alt: "A villa" }, styles: {} },
      ],
    }],
  }] },
}] as never;

const reply = `I'll make the headline punchier and add a trust badge above it.
\`\`\`plexo-commands
[
  {"op":"updateElement","nodeId":"headline","text":"Your Lisbon home is waiting.","responsive":{"mobile":{"fontSize":"36px"}}},
  {"op":"addElement","parentId":"grid","afterNodeId":"photo","element":{"type":"badge","content":"612 homes sold","styles":{"padding":"6px 12px"}}},
  {"op":"updateElement","nodeId":"grid","style":{"gridColumns":3}}
]
\`\`\``;

describe("SOL restructuring a hand-built template section (published SDK)", () => {
  it("sees the section as an outline and changes words, structure and layout in one answer", () => {
    const ds = createDefaultDesignSystem();
    const outline = describeDesign(pages(), ds).pages[0].sections[0];
    expect(outline.freeForm).toBe(true);
    expect(JSON.stringify(outline.elements)).toContain('"id":"headline"');

    const parsed = parseSolReply(reply);
    expect(parsed.commands).toHaveLength(3);
    const out = applyCommands(pages(), ds, parsed.commands!);
    expect(out.results.every((r) => r.ok)).toBe(true);
    const grid = (out.pages[0].rootNode.children![0].children as unknown as Array<{ id: string; styles: Record<string, unknown>; children: Array<{ id: string; content?: string; responsive?: unknown }> }>)[0];
    expect(grid.styles.gridColumns).toBe(3);
    expect(grid.children.map((c) => c.id).slice(0, 2)).toEqual(["headline", "photo"]);
    expect(grid.children).toHaveLength(3);
    expect(grid.children[0]).toMatchObject({ content: "Your Lisbon home is waiting.", responsive: { mobile: { fontSize: "36px" } } });
    expect(grid.children[2].content).toBe("612 homes sold");
  });
});
