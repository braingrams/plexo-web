import { afterEach, describe, expect, it, vi } from "vitest";
import { validSiteKey, verifyCaptcha } from "@/lib/forms/captcha";

afterEach(() => vi.unstubAllGlobals());

describe("verifyCaptcha", () => {
  it("fails without an answer, without asking the provider", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await verifyCaptcha({ provider: "turnstile", secret: "s", token: null })).toBe("failed");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the secret and answer to the provider's own address", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    vi.stubGlobal("fetch", fetchMock);
    expect(await verifyCaptcha({ provider: "turnstile", secret: "sec", token: "tok", ip: "1.2.3.4" })).toBe("ok");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(String(init.body)).toContain("secret=sec");
    expect(String(init.body)).toContain("response=tok");
  });

  it("rejects a wrong answer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: false }) }));
    expect(await verifyCaptcha({ provider: "recaptcha", secret: "s", token: "bad" })).toBe("failed");
  });

  it("never locks real visitors out when the provider is down", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    expect(await verifyCaptcha({ provider: "hcaptcha", secret: "s", token: "t" })).toBe("unavailable");
  });
});

describe("validSiteKey", () => {
  it("accepts real keys and refuses anything that could break out of a page", () => {
    expect(validSiteKey("0x4AAAAAADcYRIowzCZgtAXn")).toBe(true);
    expect(validSiteKey("6Ldpg34eAAAAAJtPg3__B816Axq2E3INH5vAP69Y")).toBe(true);
    expect(validSiteKey('x"><script>')).toBe(false);
    expect(validSiteKey("short")).toBe(false);
  });
});
