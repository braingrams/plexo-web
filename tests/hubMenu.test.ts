import { describe, expect, it } from "vitest";
import { menuWithout } from "@/lib/dashboardV3/hubMenuLinks";

const design = (links: { label: string; href: string }[]) => ({ pages: [{ rootNode: { children: [{ id: "hdr", props: { block: { kind: "header", content: { links } } } }] } }] }) as never;

describe("hiding a page from the menu", () => {
  it("removes only that link", () => {
    const d = design([{ label: "Home", href: "/" }, { label: "About", href: "/about" }]);
    expect(menuWithout(d, "/about")).toEqual({ sectionId: "hdr", links: [{ label: "Home", href: "/" }] });
  });
  it("does nothing when it was not in the menu", () => expect(menuWithout(design([{ label: "Home", href: "/" }]), "/about")).toBeNull());
});
