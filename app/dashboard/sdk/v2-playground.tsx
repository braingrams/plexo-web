"use client";

import { useEffect, useRef, useState } from "react";
import type { V2EditorRef } from "@charisol/plexo-sdk/v2";

type SdkV2 = typeof import("@charisol/plexo-sdk/v2");
type Compiled = { html: string; document: string; warnings: string[] };

const muted = "rgba(240,242,255,0.5)";

// A live try-it for SDK 2: the real editor on a blank page, running offline in the browser, plus a button that
// runs the same pages through the hosted compile call. Nothing here is saved.
export function V2Playground() {
  const [sdk, setSdk] = useState<SdkV2 | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Compiled | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const editor = useRef<V2EditorRef>(null);

  useEffect(() => {
    let cancelled = false;
    // The editor's stylesheet is only needed (and only loaded) once someone opens the playground.
    Promise.all([import("@charisol/plexo-sdk/v2"), import("@charisol/plexo-sdk/dist/plexo-sdk.css")])
      .then(([mod]) => !cancelled && setSdk(mod))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);

  async function compile() {
    if (!editor.current) return;
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch("/api/v1/compile-v2", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": "workspace-internal" },
        body: JSON.stringify({ pages: editor.current.getPages(), designSystem: editor.current.getDesignSystem() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Couldn't compile this page. Try again in a moment.");
      setResult(body as Compiled);
    } catch (err) {
      setResult(null);
      setProblem(err instanceof Error ? err.message : "Couldn't compile this page. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  const Editor = sdk?.V2Editor;

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap" }}>
        <p style={{ fontSize: "0.82rem", color: muted, margin: 0, maxWidth: 640, lineHeight: 1.5 }}>
          This is the real editor, running here in your browser. Build something, then compile it to see the HTML your product would receive. Nothing is saved.
        </p>
        <button
          type="button"
          className="btn-brand"
          disabled={!Editor || busy}
          onClick={() => void compile()}
          style={{ padding: "0.55rem 1.1rem", fontSize: "0.82rem", opacity: !Editor || busy ? 0.6 : 1 }}
        >
          {busy ? "Compiling…" : "Compile this page"}
        </button>
      </div>

      <div style={{ height: "min(78vh, 720px)", minHeight: 480, position: "relative", borderRadius: 14, overflow: "hidden", border: "1px solid rgba(255,255,255,0.1)", background: "#0d0f1a" }}>
        {failed ? (
          <p style={{ padding: "1.5rem", color: muted, fontSize: "0.9rem" }}>
            The live editor couldn&apos;t load in this browser. The code above still works. The classic playground is on the Classic tab.
          </p>
        ) : !Editor ? (
          <p style={{ padding: "1.5rem", color: muted, fontSize: "0.9rem" }}>Loading the editor…</p>
        ) : (
          <div style={{ position: "absolute", inset: 0 }}>
            <Editor ref={editor} features={{ pageSwitcher: false }} />
          </div>
        )}
      </div>

      {problem && <p role="alert" style={{ color: "#f87171", fontSize: "0.85rem", margin: 0 }}>{problem}</p>}

      {result && (
        <div style={{ display: "grid", gap: "0.6rem" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem", flexWrap: "wrap" }}>
            <strong style={{ fontSize: "0.9rem", color: "#f0f2ff" }}>Compiled page ({Math.round(result.document.length / 1024) || 1} KB)</strong>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(result.document).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                });
              }}
              style={{ background: "none", border: "none", cursor: "pointer", color: copied ? "#34d399" : muted, fontSize: "0.78rem", fontWeight: 600, fontFamily: "inherit" }}
            >
              {copied ? "Copied!" : "Copy the full page"}
            </button>
          </div>
          {result.warnings.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: "1.1rem", color: "#fbbf24", fontSize: "0.82rem", lineHeight: 1.5 }}>
              {result.warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          )}
          <pre style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: "0.85rem", fontFamily: "monospace", fontSize: "0.75rem", color: "rgba(240,242,255,0.85)", overflow: "auto", maxHeight: 320, margin: 0 }}>
            {result.html}
          </pre>
        </div>
      )}
    </div>
  );
}
