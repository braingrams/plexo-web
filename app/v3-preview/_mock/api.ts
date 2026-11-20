"use client";

// DEV-ONLY helper for the preview routes: answers the app's own /api calls with made-up data so the REAL
// screens can be mounted without a database or sign-in. Unknown /api GETs get an empty object.
export type MockCtx = { url: URL; method: string; body: any };
export type MockHandler = { test: RegExp; method?: string; res: (c: MockCtx) => unknown };

export const asJson = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

export function installMock(handlers: MockHandler[]) {
  if (typeof window === "undefined") return;
  const w = window as unknown as { __mockInstalled?: boolean; __mockHandlers?: MockHandler[] };
  w.__mockHandlers = handlers;
  if (w.__mockInstalled) return;
  w.__mockInstalled = true;
  const real = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href, window.location.origin);
    const method = (init?.method ?? "GET").toUpperCase();
    if (!url.pathname.startsWith("/api/")) return real(input, init);
    let body: unknown = undefined;
    try { body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined; } catch { /* not json */ }
    for (const h of w.__mockHandlers ?? []) {
      if (h.test.test(url.pathname + url.search) && (!h.method || h.method === method)) {
        const out = h.res({ url, method, body });
        if (out instanceof Response) return out;
        return asJson(out);
      }
    }
    return asJson({});
  };
}
