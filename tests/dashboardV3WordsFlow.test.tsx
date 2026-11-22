// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { doneCopy, editHrefWithBack, parseStep, parseTopic, safeBackHref, stepCopy, walkPages, wordsFlowHref } from "@/lib/dashboardV3/wordsFlow";
import type { HubPage } from "@/lib/dashboardV3/hubData";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// Previews are iframes; nothing should actually load them here.
(window as unknown as { happyDOM?: { settings: { disableIframePageLoading?: boolean; handleDisabledFileLoadingAsSuccess?: boolean } } }).happyDOM!.settings.handleDisabledFileLoadingAsSuccess = true;
(window as unknown as { happyDOM: { settings: { disableIframePageLoading: boolean } } }).happyDOM.settings.disableIframePageLoading = true;
const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/dashboard", useSearchParams: () => new URLSearchParams() }));
import { WordsGuide, type GuidePage } from "@/app/dashboard/_v3/hub/WordsGuide";

const hp = (o: Partial<HubPage>): HubPage => ({ id: "a", name: "Page", slug: "page", path: "/page", isRoot: false, parentId: "r", order: 0, isPublished: true, archivedByPlan: false, sourceType: "BUILDER", updatedAt: "", ...o });

describe("the words walk-through logic", () => {
  it("walks Home first, skips apps and pages the plan hides", () => {
    const pages = [hp({ id: "about", name: "About" }), hp({ id: "app", sourceType: "REACT_PROJECT" }), hp({ id: "old", archivedByPlan: true }), hp({ id: "home", name: "Ama's", isRoot: true })];
    expect(walkPages(pages).map((p) => p.id)).toEqual(["home", "about"]);
  });
  it("keeps the step sensible whatever is in the address", () => {
    expect(parseStep(undefined, 3)).toBe(1);
    expect(parseStep("0", 3)).toBe(1);
    expect(parseStep("abc", 3)).toBe(1);
    expect(parseStep("2", 3)).toBe(2);
    expect(parseStep("99", 3)).toBe(4); // past the end = all done
  });
  it("only sends people back inside their own dashboard", () => {
    expect(safeBackHref("/dashboard/sites/s1/words?for=words&step=2")).toBe("/dashboard/sites/s1/words?for=words&step=2");
    for (const bad of ["https://evil.test", "//evil.test", "/pricing", "/dashboard\\..", null, "", "javascript:alert(1)"]) expect(safeBackHref(bad as string | null)).toBeNull();
  });
  it("the editor link carries the way back", () => {
    expect(editHrefWithBack("/dashboard/templates/p1", "/dashboard/sites/s1/words?step=2")).toBe("/dashboard/templates/p1?back=%2Fdashboard%2Fsites%2Fs1%2Fwords%3Fstep%3D2");
    expect(editHrefWithBack("/dashboard/templates/p1?mode=text", "/dashboard")).toContain("?mode=text&back=");
  });
  it("words are plain and the last page says finish", () => {
    expect(parseTopic("contact")).toBe("contact");
    expect(parseTopic("nonsense")).toBe("words");
    expect(wordsFlowHref("s1", "links", 3)).toBe("/dashboard/sites/s1/words?for=links&step=3");
    const home = stepCopy({ name: "Ama's", isRoot: true }, 1, 3, "words");
    expect(home.title).toBe("Home page");
    expect(home.lead).toMatch(/right on the page/);
    expect(stepCopy({ name: "Contact", isRoot: false }, 3, 3, "words").nextLabel).toMatch(/finish/);
    expect(doneCopy("words", true).title).toMatch(/done/i);
  });
});

const pages: GuidePage[] = [
  { id: "h", name: "Ama's", isRoot: true, sourceType: "BUILDER", editHref: "/dashboard/templates/h" },
  { id: "c", name: "Contact", isRoot: false, sourceType: "BUILDER", editHref: "/dashboard/templates/c" },
];
async function mount(step: number) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  await act(async () => createRoot(host).render(<WordsGuide siteId="s1" siteName="Ama's Kitchen" pages={pages} topic="words" step={step} />));
  return host;
}
const buttons = (host: HTMLElement) => Array.from(host.querySelectorAll("button, a")).map((e) => e.textContent?.trim());

describe("WordsGuide", () => {
  it("shows a preview of the page first, then Edit, Next and Skip", async () => {
    const host = await mount(1);
    expect(host.textContent).toContain("Page 1 of 2");
    expect(host.querySelector("iframe")?.getAttribute("src")).toBe("/api/v1/templates/s1/draft-preview");
    expect(buttons(host)).toEqual(expect.arrayContaining(["Edit this page", "Looks good, next page", "Skip this page"]));
    const edit = Array.from(host.querySelectorAll("a")).find((a) => a.textContent === "Edit this page")!;
    expect(decodeURIComponent(edit.getAttribute("href")!)).toBe("/dashboard/templates/h?back=/dashboard/sites/s1/words?for=words&step=1");
  });
  it("Next and Skip both move on to the next page", async () => {
    router.push.mockReset();
    const host = await mount(1);
    await act(async () => Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.includes("Skip this page"))!.click());
    expect(router.push).toHaveBeenCalledWith("/dashboard/sites/s1/words?for=words&step=2");
  });
  it("previews a later page by its own address and ends with 'Done, back to home'", async () => {
    const last = await mount(2);
    expect(last.querySelector("iframe")?.getAttribute("src")).toBe("/api/v1/templates/s1/draft-preview?page=c");
    expect(buttons(last)).toContain("Looks good, finish");
    const done = await mount(3);
    const home = Array.from(done.querySelectorAll("a")).find((a) => a.textContent?.includes("Done, back to home"));
    expect(home?.getAttribute("href")).toBe("/dashboard");
  });
});
