// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { ProductBrowser } from "@/app/dashboard/_v3/hub/ProductBrowser";
import { RelatedPicker, ProductImages } from "@/app/dashboard/_v3/hub/ProductMedia";
import type { HubProduct } from "@/lib/dashboardV3/hubData";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const make = (n: number): HubProduct[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `Product ${i + 1}`, description: null, kind: "PHYSICAL", priceMinor: 100000 + i, imageUrl: null, active: i !== 1, stockQuantity: i === 0 ? 0 : 5, category: i === 2 ? "Spices" : null }));

async function mount(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(node));
  return host;
}
const click = (el: Element | null | undefined) => act(async () => (el as HTMLElement).click());
const byText = (host: HTMLElement, sel: string, text: string) => Array.from(host.querySelectorAll<HTMLElement>(sel)).find((e) => e.textContent?.includes(text));

describe("ProductBrowser", () => {
  it("pages the products and remembers grid or list", async () => {
    window.localStorage.clear();
    const host = await mount(<ProductBrowser products={make(30)} currency="NGN" onOpen={() => {}} onBulk={() => {}} />);
    expect(host.querySelectorAll(".plx-pcard")).toHaveLength(12);
    expect(host.textContent).toContain("Showing 1–12 of 30 products");
    await click(byText(host, "button", "Next"));
    expect(host.textContent).toContain("Showing 13–24");
    await click(byText(host, "button[role=radio]", "List"));
    expect(host.querySelectorAll(".plx-plist__row")).toHaveLength(12);
    expect(window.localStorage.getItem("plexo.hub.productsLayout")).toBe("list");
    // A second visit opens in the list.
    const again = await mount(<ProductBrowser products={make(3)} currency="NGN" onOpen={() => {}} onBulk={() => {}} />);
    expect(again.querySelectorAll(".plx-plist__row")).toHaveLength(3);
  });

  it("list shows category, stock count and an In stock / Out of stock badge, and opens a product on click", async () => {
    window.localStorage.setItem("plexo.hub.productsLayout", "list");
    const onOpen = vi.fn();
    const host = await mount(<ProductBrowser products={make(3)} currency="NGN" onOpen={onOpen} onBulk={() => {}} />);
    const rows = host.querySelectorAll(".plx-plist__row");
    expect(rows[0].textContent).toContain("Out of stock");
    expect(rows[2].textContent).toContain("In stock");
    expect(rows[2].textContent).toContain("Spices");
    expect(rows[1].textContent).toContain("Hidden");
    await click(rows[2].querySelector("button"));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "p3" }));
  });

  it("select several shows a checkbox on every product, select-all covers the page, and actions get the chosen ids", async () => {
    window.localStorage.setItem("plexo.hub.productsLayout", "grid");
    const onBulk = vi.fn();
    const host = await mount(<ProductBrowser products={make(14)} currency="NGN" onOpen={() => {}} onBulk={onBulk} />);
    expect(host.querySelectorAll("input[type=checkbox]")).toHaveLength(0);
    await click(byText(host, "button", "Select several"));
    expect(host.querySelectorAll(".plx-pcard input[type=checkbox]")).toHaveLength(12);
    const hide = byText(host, "button", "Hide") as HTMLButtonElement;
    expect(hide.disabled).toBe(true);
    await click(host.querySelector(".plx-bulkbar input[type=checkbox]"));
    expect(host.textContent).toContain("12 chosen");
    await click(byText(host, "button", "Hide"));
    expect(onBulk).toHaveBeenCalledWith("hide", expect.arrayContaining(["p1", "p12"]));
    expect(onBulk.mock.calls[0][1]).toHaveLength(12);
    // Clicking a card in this mode picks it instead of opening it.
    await click(host.querySelector(".plx-bulkbar input[type=checkbox]"));
    await click(host.querySelector(".plx-pcard__open"));
    expect(host.textContent).toContain("1 chosen");
    await click(byText(host, "button", "Done"));
    expect(host.querySelectorAll("input[type=checkbox]")).toHaveLength(0);
  });
});

describe("ProductMedia", () => {
  it("lets you choose the cover, reorder and remove pictures", async () => {
    const onChange = vi.fn();
    const host = await mount(<ProductImages images={["a", "b", "c"]} onChange={onChange} onError={() => {}} />);
    expect(host.textContent).toContain("Cover");
    await click(host.querySelector('[aria-label="Make photo 3 the cover"]'));
    expect(onChange).toHaveBeenLastCalledWith(["c", "a", "b"]);
    await click(host.querySelectorAll('[aria-label="Move later"]')[0]);
    expect(onChange).toHaveBeenLastCalledWith(["b", "a", "c"]);
    await click(host.querySelector('[aria-label="Remove photo 2"]'));
    expect(onChange).toHaveBeenLastCalledWith(["a", "c"]);
  });

  it("'Products I sell together' picks at most three and hides itself when there is nothing to pick", async () => {
    const onChange = vi.fn();
    const none = await mount(<RelatedPicker options={[]} chosen={[]} onChange={onChange} />);
    expect(none.textContent).toBe("");
    const host = await mount(<RelatedPicker options={make(5)} chosen={["p1", "p2", "p3"]} onChange={onChange} />);
    expect(host.textContent).toContain("Products I sell together");
    const boxes = host.querySelectorAll<HTMLInputElement>("input[type=checkbox]");
    expect(boxes[3].disabled).toBe(true);
    await click(boxes[0]);
    expect(onChange).toHaveBeenLastCalledWith(["p2", "p3"]);
  });
});
