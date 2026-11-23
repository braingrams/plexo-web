"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A customer's page shown inside the dashboard, in its own frame, so none of Plexo's styles (class names, colours, fonts) can touch
 * it: what the owner sees here is exactly what their visitors get. The page's own scripts do not run in this preview.
 * The frame grows to the height of the page, so the dashboard page scrolls as one.
 */
export function IsolatedPage({ html, head = "", title = "Preview of your page" }: { html: string; /** Extra markup for the frame's <head> (a theme's stylesheet). */ head?: string; title?: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(600);
  const doc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base target="_blank">${head}</head><body style="margin:0">${html}</body></html>`;

  const measure = useCallback(() => {
    const body = ref.current?.contentDocument?.documentElement;
    if (body) setHeight(Math.max(400, body.scrollHeight));
  }, []);

  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    let observer: ResizeObserver | undefined;
    const attach = () => {
      measure();
      const el = frame.contentDocument?.documentElement;
      if (el && typeof ResizeObserver !== "undefined") {
        observer?.disconnect();
        observer = new ResizeObserver(measure);
        observer.observe(el);
      }
    };
    frame.addEventListener("load", attach);
    return () => {
      frame.removeEventListener("load", attach);
      observer?.disconnect();
    };
  }, [measure, html]);

  return <iframe ref={ref} title={title} srcDoc={doc} sandbox="allow-same-origin allow-popups" style={{ display: "block", width: "100%", height, border: 0 }} />;
}
