import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/projectEntities", () => ({ GitHubInstallation: {} }));

import { forwardWebhook, installBounceTarget, relayOrigin } from "@/lib/projects/github/relay";
import { signInstallState, verifyInstallState } from "@/lib/projects/github/install";

// One GitHub App for staging and production: production relays staging's webhooks and bounces
// installs staging started back to it — and never anything else.

const STAGING = "https://staging-plexo.charisol.io";
const PROD = "https://plexo.charisol.io";

function asEnv(appUrl: string, relay?: string) {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", appUrl);
  vi.stubEnv("PLEXO_GITHUB_RELAY_ORIGIN", relay ?? "");
}

beforeEach(() => vi.stubEnv("AUTH_SECRET", "test-secret"));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("GitHub relay", () => {
  it("only production (with a relay origin) relays, and never to itself or over http", () => {
    asEnv(STAGING);
    expect(relayOrigin()).toBeNull();
    asEnv(PROD, STAGING);
    expect(relayOrigin()).toBe(STAGING);
    asEnv(PROD, PROD);
    expect(relayOrigin()).toBeNull();
    asEnv(PROD, "http://staging-plexo.charisol.io");
    expect(relayOrigin()).toBeNull();
  });

  it("bounces an install staging started to staging's setup route, keeping the query", () => {
    asEnv(STAGING);
    const state = signInstallState({ appId: "app1", organizationId: "org1", userId: "u1" });
    expect(verifyInstallState(state)?.appId).toBe("app1");

    asEnv(PROD, STAGING);
    const q = new URLSearchParams({ installation_id: "42", code: "abc", state });
    expect(installBounceTarget(state, q)).toBe(`${STAGING}/api/github/setup?${q.toString()}`);
  });

  it("keeps production's own installs, and ignores forged or foreign origins", () => {
    asEnv(PROD, STAGING);
    const own = signInstallState({ appId: "app1", organizationId: "org1", userId: "u1" });
    expect(installBounceTarget(own, new URLSearchParams())).toBeNull();
    const forged = Buffer.from(JSON.stringify({ origin: "https://evil.example" })).toString("base64url") + ".x";
    expect(installBounceTarget(forged, new URLSearchParams())).toBeNull();
    expect(installBounceTarget("not-json.x", new URLSearchParams())).toBeNull();
  });

  it("forwards the raw body and GitHub's signature headers unchanged", async () => {
    asEnv(PROD, STAGING);
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const headers = new Headers({ "content-type": "application/json", "x-github-event": "push", "x-hub-signature-256": "sha256=abc", cookie: "nope" });
    await forwardWebhook('{"a":1}', headers);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${STAGING}/api/webhooks/github`);
    expect(init.body).toBe('{"a":1}');
    expect(init.headers).toEqual({ "content-type": "application/json", "x-github-event": "push", "x-hub-signature-256": "sha256=abc" });
  });

  it("does nothing in staging", async () => {
    asEnv(STAGING);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await forwardWebhook("{}", new Headers());
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
