"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { C } from "./ui";

// The live app inside the editor. Talks to the bridge script Plexo injects into preview
// builds (lib/projects/previewRuntime.ts) over postMessage — only with the preview's own
// origin: route changes, runtime errors, and Select & Edit.

export type Viewport = "desktop" | "tablet" | "mobile";
export const VIEWPORT_WIDTHS: Record<Viewport, number | null> = { desktop: null, tablet: 768, mobile: 375 };

export type SelectedElement = {
  file: string;
  line: number | null;
  column: number | null;
  tag: string;
  text: string;
  classes: string;
  path: string;
};

export type PreviewError = { kind: string; message: string; stack: string | null; url: string; at: number };

export function PreviewPane(props: {
  previewUrl: string | null;
  route: string;
  reloadKey: number;
  viewport: Viewport;
  inspecting: boolean;
  building: boolean;
  onNavigate: (path: string) => void;
  onSelect: (element: SelectedElement) => void;
  onError: (error: PreviewError) => void;
}) {
  const { previewUrl, route, reloadKey, viewport, inspecting, onNavigate, onSelect, onError } = props;
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [scale, setScale] = useState(1);
  const origin = useMemo(() => (previewUrl ? new URL(previewUrl).origin : null), [previewUrl]);
  // The iframe's src only changes on an explicit reload/route jump, never on in-app
  // navigation (that would reload the app on every click).
  const [src, setSrc] = useState<string | null>(null);
  const lastReportedPath = useRef<string>(route);

  useEffect(() => {
    if (!previewUrl) return;
    setReady(false);
    setSrc(`${previewUrl}${route.startsWith("/") ? route : `/${route}`}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewUrl, reloadKey]);

  // Route typed in the address bar → navigate inside the app without a reload.
  useEffect(() => {
    if (!origin || route === lastReportedPath.current) return;
    lastReportedPath.current = route;
    iframeRef.current?.contentWindow?.postMessage({ target: "plexo-preview", type: "plexo:navigate-to", path: route }, origin);
  }, [route, origin]);

  const post = useCallback(
    (message: Record<string, unknown>) => {
      if (origin) iframeRef.current?.contentWindow?.postMessage({ target: "plexo-preview", ...message }, origin);
    },
    [origin],
  );

  useEffect(() => {
    post({ type: "plexo:inspect", enabled: inspecting });
  }, [inspecting, ready, post]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (!origin || event.origin !== origin || event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data as { source?: string; type?: string; [k: string]: any };
      if (data?.source !== "plexo-preview") return;
      if (data.type === "plexo:ready") {
        setReady(true);
        if (typeof data.path === "string") {
          lastReportedPath.current = data.path;
          onNavigate(data.path);
        }
      } else if (data.type === "plexo:navigate" && typeof data.path === "string") {
        lastReportedPath.current = data.path;
        onNavigate(data.path);
      } else if (data.type === "plexo:selected" && data.element) {
        onSelect(data.element as SelectedElement);
      } else if (data.type === "plexo:error" && data.error) {
        onError(data.error as PreviewError);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [origin, onNavigate, onSelect, onError]);

  // Fit tablet/mobile frames into narrow containers by scaling, keeping true CSS widths.
  const width = VIEWPORT_WIDTHS[viewport];
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !width) {
      setScale(1);
      return;
    }
    const observer = new ResizeObserver(([entry]) => setScale(Math.min(1, (entry.contentRect.width - 32) / width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, [width]);

  if (!previewUrl) {
    return <Centered>Your app's preview will appear here after its first build.</Centered>;
  }

  return (
    <div ref={containerRef} style={{ position: "relative", height: "100%", overflow: "hidden", background: width ? "var(--ed-sunken)" : "#fff", display: "flex", justifyContent: "center", alignItems: width ? "flex-start" : "stretch", padding: width ? "16px 0" : 0 }}>
      <div
        style={{
          width: width ?? "100%",
          height: width ? `calc((100% - 0px) / ${scale})` : "100%",
          transform: width ? `scale(${scale})` : undefined,
          transformOrigin: "top center",
          borderRadius: width ? 18 : 0,
          overflow: "hidden",
          boxShadow: width ? "0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px var(--ed-w-080)" : undefined,
          background: "#fff",
          flexShrink: 0,
        }}
      >
        {src && (
          <iframe
            ref={iframeRef}
            // Remounting reloads the app without adding anything to its URL.
            key={`${src}#${reloadKey}`}
            src={src}
            title="App preview"
            // Its own origin already isolates it from the dashboard; these let a real app run
            // (forms, popups for OAuth, modals) the way it will for visitors.
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads"
            allow="clipboard-write; geolocation; camera; microphone"
            style={{ width: "100%", height: "100%", border: "none", display: "block", background: "#fff" }}
          />
        )}
      </div>
      {inspecting && (
        <div style={{ position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)", padding: "0.35rem 0.75rem", borderRadius: 999, background: "var(--ed-cta)", color: "var(--ed-on-brand)", fontSize: "0.74rem", fontWeight: 600, boxShadow: "0 6px 20px rgba(0,0,0,0.4)", pointerEvents: "none" }}>
          Click anything in your app to edit it
        </div>
      )}
      {props.building && (
        <div style={{ position: "absolute", bottom: 12, right: 12, padding: "0.35rem 0.7rem", borderRadius: 999, background: "color-mix(in srgb, var(--ed-bg) 85%, transparent)", border: `1px solid ${C.border}`, color: C.text, fontSize: "0.72rem", display: "flex", alignItems: "center", gap: 6 }}>
          <span className="plexo-spin" style={{ width: 10, height: 10, borderRadius: "50%", border: `2px solid ${C.brand}`, borderTopColor: "transparent", display: "inline-block" }} />
          Updating preview…
          <style>{`.plexo-spin{animation:plexo-spin .8s linear infinite}@keyframes plexo-spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      )}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div style={{ height: "100%", display: "grid", placeItems: "center", color: C.muted, fontSize: "0.85rem", padding: "2rem", textAlign: "center" }}>{children}</div>;
}
