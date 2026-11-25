// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import type { HomeView, ShellChrome, TourState } from "@/lib/dashboardV3/tour";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const nav = vi.hoisted(() => ({ path: "/dashboard/settings", push: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.path,
  useRouter: () => ({ push: nav.push, replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { TourProvider, useTour } from "@/app/dashboard/_v3/tour/TourProvider";

const full: ShellChrome = { frame: "full", sidebarMenu: true, folded: false, tabbarSol: true };
const roots: ReturnType<typeof createRoot>[] = [];

/** Stands in for the shell and for Home: reports what they would report. */
function Reporter({ chrome, view, mountedHome = true }: { chrome: ShellChrome; view?: HomeView; mountedHome?: boolean }) {
  const tour = useTour();
  useEffect(() => {
    tour.reportShell(chrome);
  }, [tour.reportShell, chrome]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (view && mountedHome) tour.reportHomeView(view);
  }, [tour.reportHomeView, view, mountedHome]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

async function mount(state: TourState, children: React.ReactNode, persisted: TourState[] = []) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () =>
    root.render(
      <TourProvider initialState={state} initialDriving onPersist={(s) => persisted.push(s)} context={{ siteId: "s1", experience: "beginner" }}>
        {children}
      </TourProvider>,
    ),
  );
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  return persisted;
}

afterEach(async () => {
  await act(async () => { for (const r of roots.splice(0)) r.unmount(); });
  document.body.innerHTML = "";
  nav.push.mockClear();
});

const active: TourState = { status: "active", mode: "short", stepId: "home-intro" };

describe("the tour engine never lets a card wait for something that cannot appear", () => {
  it("started from another page, it goes to Home first to learn the view, and shows no card on the way", async () => {
    nav.path = "/dashboard/settings";
    await mount(active, <Reporter chrome={full} />);
    expect(nav.push).toHaveBeenCalledWith("/dashboard");
    expect(document.querySelector(".plx-tour-card")).toBeNull();
  });

  it("on Home it waits for Home to say which view it is: no card until then, and none for a step that view lacks", async () => {
    nav.path = "/dashboard";
    const persisted: TourState[] = [];
    await mount(active, <Reporter chrome={full} />, persisted);
    expect(document.querySelector(".plx-tour-card")).toBeNull();
    expect(nav.push).not.toHaveBeenCalled(); // already where it needs to be
    expect(persisted).toHaveLength(0); // and the saved step is left alone while waiting
  });

  it("when Home turns out to be the every-site view, the tour moves on to the next step in order (not back to the start)", async () => {
    nav.path = "/dashboard";
    const persisted: TourState[] = [];
    await mount(active, <Reporter chrome={full} view="all" />, persisted);
    expect(persisted.at(-1)?.stepId).toBe("ask-sol");
    expect(persisted.at(-1)?.status).toBe("active");
  });

  it("a Home step that exists in this view stays where it is", async () => {
    nav.path = "/dashboard";
    const persisted: TourState[] = [];
    await mount(active, <Reporter chrome={full} view="guided" />, persisted);
    expect(persisted.filter((s) => s.stepId && s.stepId !== "home-intro")).toHaveLength(0);
  });

  it("a shell-wide step reached from the page editor (no top bar) moves to Home instead of waiting", async () => {
    nav.path = "/dashboard/templates/abc";
    const editor: ShellChrome = { frame: "editor", sidebarMenu: true, folded: true, tabbarSol: false };
    await mount({ status: "active", mode: "short", stepId: "help-menu" }, <Reporter chrome={editor} view="live" mountedHome={false} />);
    // Home has not been visited yet in this test, so the tour first goes there; either way it never sits on the editor.
    expect(nav.push).toHaveBeenCalledWith("/dashboard");
    expect(document.querySelector(".plx-tour-card")).toBeNull();
  });
});
