// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SellTemplateCard } from "@/app/dashboard/_v3/hub/SellTemplateCard";
import { OptimisticLoader } from "@/app/dashboard/_v3/ui/OptimisticLoader";
import { PALETTE_PRESETS } from "@/lib/onboarding/palettes";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("SellTemplateCard", () => {
  it("renders sell template card with actions", () => {
    act(() => {
      root.render(<SellTemplateCard siteId="site-123" siteName="My Awesome Bakery" />);
    });
    expect(container.textContent).toContain("Sell this template to earn");
    expect(container.textContent).toContain("Sell this template");
    const sellLink = container.querySelector('a[href*="/dashboard/marketplace/sell?templateId=site-123"]');
    expect(sellLink).not.toBeNull();
  });
});

describe("OptimisticLoader", () => {
  it("renders animated action words", () => {
    act(() => {
      root.render(<OptimisticLoader variant="page" stage="finding-designs" siteName="Acme" />);
    });
    expect(container.textContent).toContain("Finding the best look for Acme");
    expect(container.textContent).toContain("Putting together your brand data");
  });
});

describe("OptimisticLoader inline", () => {
  it("is a quiet skeleton, not the full page builder", () => {
    act(() => {
      root.render(<OptimisticLoader subtitle="Loading brand style" />);
    });
    expect(container.querySelector(".plx-pb")).toBeNull();
    expect(container.querySelector('[role="status"]')?.getAttribute("aria-label")).toBe("Loading brand style");
  });
});

describe("PALETTE_PRESETS", () => {
  it("provides valid presets", () => {
    expect(PALETTE_PRESETS.length).toBeGreaterThan(4);
    for (const p of PALETTE_PRESETS) {
      expect(p.colors.length).toBe(4);
    }
  });
});
