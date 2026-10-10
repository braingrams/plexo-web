// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Staging, telly: clicking Publish sent the request and the app went live, but the dialog sat
// on "Building a clean copy" forever — its own clean-up cancelled the status checks the moment
// publishing started, and a cancelled check is treated as "dialog closed", so nothing showed.

const calls = vi.hoisted(() => ({ polls: 0 }));
vi.mock("@/app/dashboard/apps/_components/api", async (orig) => {
  const real = await orig<typeof import("@/app/dashboard/apps/_components/api")>();
  return {
    ...real,
    appsApi: { ...real.appsApi, publish: vi.fn(async () => ({ buildId: "b1" })), diff: vi.fn(async () => ({ diff: { added: [], changed: ["a"], removed: [] } })) },
    // Like the real pollBuild: a cancelled check stops instead of reporting.
    pollBuild: vi.fn(async (_app: string, _build: string, onUpdate: (r: unknown) => void, signal?: AbortSignal) => {
      await new Promise((r) => setTimeout(r, 0));
      if (signal?.aborted) throw new DOMException("aborted", "AbortError");
      calls.polls += 1;
      const report = { ok: true, pending: false, status: "SUCCEEDED", liveUrl: "https://telly.example.com" };
      onUpdate(report);
      return report;
    }),
  };
});

import { PublishDialog } from "@/app/dashboard/apps/_components/PublishDialog";

const summary = { id: "a1", name: "telly", previewUrl: "https://preview--x.example.com", liveUrl: "https://telly.example.com", published: true, domains: [], headVersionId: "v2", latestBuild: null, liveBuild: { id: "b0", versionId: "v1", finishedAt: null }, databases: [] };

afterEach(() => {
  document.body.innerHTML = "";
  calls.polls = 0;
});

describe("publishing from the dialog", () => {
  it("follows the publish through to live", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onPublished = vi.fn();
    await act(async () => root.render(<PublishDialog appId="a1" summary={summary as never} onClose={() => {}} onPublished={onPublished} />));
    const button = [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Publish")!;
    await act(async () => {
      button.click();
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(calls.polls).toBe(1);
    expect(onPublished).toHaveBeenCalled();
    expect(container.textContent).toContain("Your app is live");
    await act(async () => root.unmount());
  });
});
