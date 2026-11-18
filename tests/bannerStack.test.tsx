// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { BannerStack, InBannerStack } from "@/app/dashboard/_v3/ui/BannerStack";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function mount(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(node));
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return { host, root };
}
const folded = (host: HTMLElement) => Array.from(host.querySelectorAll("[data-banner-folded]")).map((e) => e.textContent);
const button = (host: HTMLElement) => host.querySelector<HTMLButtonElement>(".plx-banners__more");

describe("the banner stack", () => {
  it("shows one banner and folds the rest behind a button that opens and closes them", async () => {
    const { host } = await mount(
      <BannerStack banners={<><p>Plan</p><p>What&apos;s new</p></>}>
        <InBannerStack><p>Customize</p></InBannerStack>
      </BannerStack>,
    );
    expect(folded(host)).toEqual(["What's new", "Customize"]);
    expect(button(host)?.textContent).toContain("2 more notices");
    await act(async () => button(host)!.click());
    expect(folded(host)).toEqual([]);
    expect(button(host)?.textContent).toContain("Show less");
    expect(button(host)?.getAttribute("aria-expanded")).toBe("true");
    await act(async () => button(host)!.click());
    expect(folded(host)).toHaveLength(2);
  });

  it("has no button when there is only one banner, and ignores banners that render nothing", async () => {
    const { host } = await mount(<BannerStack banners={<><p>Only one</p>{null}</>} />);
    expect(button(host)).toBeNull();
    expect(folded(host)).toEqual([]);
  });

  it("shows a page's banner in place when there is no stack", async () => {
    const { host } = await mount(<InBannerStack><p>Alone</p></InBannerStack>);
    expect(host.textContent).toBe("Alone");
  });
});
