// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

let pathname = "/dashboard";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const counts = { pages: 26, pagesDone: 0, pagesFailed: 0, posts: 542, postsDone: 312, postsFailed: 0, assets: 949, assetsDone: 0, assetsFailed: 0, assetsSkipped: 0 };
const base = { id: "job1", templateId: "site1", sourceUrl: "maildrip.io", siteName: "MailDrip", createdAt: "2026-10-07T18:00:00Z", finishedAt: null, counts, estimatedSecondsLeft: 600, pausedReason: null };

async function render(migrations: unknown[]) {
  vi.resetModules();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ migrations }), { status: 200 })));
  const { MigrationBanner } = await import("@/app/dashboard/migrate/wordpress/MigrationBanner");
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => {
    createRoot(el).render(<MigrationBanner />);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return el;
}

afterEach(() => {
  document.body.innerHTML = "";
  pathname = "/dashboard";
});

describe("dashboard migration banner", () => {
  it("shows a running move on every page: what's happening, time left, and a way back", async () => {
    const el = await render([{ ...base, phase: "POSTS" }]);
    expect(el.textContent).toContain("Moving MailDrip to Plexo");
    expect(el.textContent).toContain("312 of 542 blog posts");
    expect(el.textContent).toContain("About 10 minutes left");
    expect(el.textContent).toContain("we'll email you when it's done");
    expect(el.querySelector("a")?.getAttribute("href")).toBe("/dashboard/migrate/wordpress?site=site1&job=job1");
  });

  it("a paused move says why and offers to continue", async () => {
    const el = await render([{ ...base, phase: "PAUSED_ERROR", pausedReason: "The pages step stopped: Your WordPress site didn't respond" }]);
    expect(el.textContent).toContain("has paused");
    expect(el.textContent).toContain("didn't respond");
    expect(el.textContent).toContain("Continue the move");
  });

  it("a finished move points to the report until dismissed", async () => {
    const el = await render([{ ...base, phase: "COMPLETED", finishedAt: new Date().toISOString() }]);
    expect(el.textContent).toContain("MailDrip has moved to Plexo");
    await act(async () => (el.querySelector('button[aria-label="Dismiss"]') as HTMLButtonElement).click());
    expect(el.textContent).toBe("");
  });

  it("stays out of the way on the migration screen itself", async () => {
    pathname = "/dashboard/migrate/wordpress";
    const el = await render([{ ...base, phase: "POSTS" }]);
    expect(el.textContent).toBe("");
  });
});
