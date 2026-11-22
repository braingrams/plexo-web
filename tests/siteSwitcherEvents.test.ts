// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { OPEN_SITE_SWITCHER_EVENT, openSiteSwitcher } from "@/lib/dashboardV3/siteSwitcherEvents";

afterEach(() => { document.body.innerHTML = ""; });

describe("openSiteSwitcher", () => {
  it("tells the switcher to open when the screen has one", () => {
    document.body.innerHTML = '<div data-tour="site-switcher"><button>Ama</button></div>';
    const on = vi.fn();
    window.addEventListener(OPEN_SITE_SWITCHER_EVENT, on, { once: true });
    expect(openSiteSwitcher()).toBe(true);
    expect(on).toHaveBeenCalledTimes(1);
  });
  it("returns false when there is no switcher, so the caller can use the sites list", () => {
    expect(openSiteSwitcher()).toBe(false);
  });
});
