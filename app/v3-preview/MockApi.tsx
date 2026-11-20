"use client";

import { useEffect, useState } from "react";

/** DEV ONLY: answers the screens' own requests with made-up data, so a screen can be built and photographed with no sign-in and no database. */
export type MockHandler = (req: { method: string; path: string; query: URLSearchParams; body: Record<string, unknown> }) => unknown | undefined;

export function MockApi({ handler, children }: { handler: MockHandler; children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const original = window.fetch;
    window.fetch = async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, window.location.origin);
      if (!url.pathname.startsWith("/api/v1/sites/")) return original(input, init);
      let body: Record<string, unknown> = {};
      try {
        body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
      } catch {
        body = {};
      }
      await new Promise((r) => setTimeout(r, 120));
      const out = handler({ method: (init?.method ?? "GET").toUpperCase(), path: url.pathname.replace(/^\/api\/v1\/sites\/[^/]+/, ""), query: url.searchParams, body });
      if (out === undefined) return new Response(JSON.stringify({ error: "Not available in the preview." }), { status: 404, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } });
    };
    setReady(true);
    return () => {
      window.fetch = original;
    };
  }, [handler]);
  return ready ? <>{children}</> : null;
}
