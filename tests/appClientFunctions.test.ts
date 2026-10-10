// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { plexo } from "@/lib/projects/scaffold/template/src/lib/plexo";

// Streamily on staging: its create-checkout function replied {"url":"https://checkout…"}, but
// the app's client handed back the reply's `data` field — null — so it said "Couldn't start
// checkout". A function's reply now arrives exactly as the function sent it.

afterEach(() => vi.unstubAllGlobals());

describe("calling a server function from an app", () => {
  it("gives back exactly what the function returned", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ url: "https://checkout.paystack.com/abc" }), { status: 200 })));
    const { data, error } = await plexo.functions.invoke<{ url: string }>("create-checkout", { body: { plan: "basic" } });
    expect(error).toBeNull();
    expect(data?.url).toBe("https://checkout.paystack.com/abc");
  });

  it("reports a failed function as an error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "Payment couldn't start" } }), { status: 400 })));
    const { data, error } = await plexo.functions.invoke("create-checkout");
    expect(data).toBeNull();
    expect(error?.message).toBe("Payment couldn't start");
  });
});
