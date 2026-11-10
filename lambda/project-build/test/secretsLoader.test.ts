import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { SECRETS_LOADER_SOURCE, ENTRY_WRAPPER_SOURCE } from "../src/ssrShims";

// The loader is written into the customer's function folder and runs there, so the test runs the
// same source from a temporary folder, with fetch replaced.
async function loadLoader(): Promise<{ loadSecrets: () => Promise<void> }> {
  const dir = mkdtempSync(join(tmpdir(), "plexo-loader-"));
  writeFileSync(join(dir, "plexo-env.mjs"), SECRETS_LOADER_SOURCE);
  return import(pathToFileURL(join(dir, "plexo-env.mjs")).href + `?v=${Math.random()}`);
}

describe("the secrets loader", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    delete process.env.STRIPE_KEY;
    delete process.env.VISIBLE_SETTING;
    process.env.PLEXO_SECRETS_URL = "https://plexo.test/api/internal/ssr-secrets/t1?env=live";
    process.env.PLEXO_SERVICE_KEY = "pxs_test";
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.PLEXO_SECRETS_URL;
    delete process.env.PLEXO_SERVICE_KEY;
  });

  it("sends the service key and sets the secrets it gets back", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: { STRIPE_KEY: "sk_live_1" } }), { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { loadSecrets } = await loadLoader();
    await loadSecrets();
    expect(process.env.STRIPE_KEY).toBe("sk_live_1");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(url).toBe("https://plexo.test/api/internal/ssr-secrets/t1?env=live");
    expect(init.headers["x-plexo-service-key"]).toBe("pxs_test");
  });

  it("leaves a visible variable alone when a secret has the same name", async () => {
    process.env.VISIBLE_SETTING = "from-variables";
    globalThis.fetch = (async () => new Response(JSON.stringify({ data: { VISIBLE_SETTING: "from-secrets" } }), { status: 200 })) as unknown as typeof fetch;
    const { loadSecrets } = await loadLoader();
    await loadSecrets();
    expect(process.env.VISIBLE_SETTING).toBe("from-variables");
  });

  it("fails closed when Plexo doesn't answer, and tries again next time", async () => {
    globalThis.fetch = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    const { loadSecrets } = await loadLoader();
    await expect(loadSecrets()).rejects.toThrow(/secrets \(500\)/);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: { STRIPE_KEY: "ok" } }), { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await loadSecrets();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(process.env.STRIPE_KEY).toBe("ok");
  });

  it("does nothing when it isn't running on Plexo", async () => {
    delete process.env.PLEXO_SECRETS_URL;
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { loadSecrets } = await loadLoader();
    await loadSecrets();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("the entry wrapper loads secrets before the server code", () => {
    expect(ENTRY_WRAPPER_SOURCE.indexOf("await loadSecrets()")).toBeLessThan(ENTRY_WRAPPER_SOURCE.indexOf('import("./app.mjs")'));
    expect(ENTRY_WRAPPER_SOURCE).toContain("export const handler");
  });
});
