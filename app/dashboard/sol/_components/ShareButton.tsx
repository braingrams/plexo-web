"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, Link2, Share2 } from "lucide-react";

type Status = { shared: boolean; url: string | null; upTo: string | null };

/**
 * Share in the chat header: a read-only link to this conversation as it is now
 * (lib/sol/share.ts). Sharing again moves the same link forward to include newer
 * messages; "Stop sharing" turns it off for everyone.
 */
export function ShareButton({ conversationId }: { conversationId: string }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const endpoint = `/api/v1/sol/conversations/${conversationId}/share`;

  useEffect(() => {
    if (!open) return;
    setError(null);
    fetch(endpoint)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setStatus)
      .catch(() => setError("Couldn't check whether this conversation is shared. Try again."));
  }, [open, endpoint]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  async function act(method: "POST" | "DELETE") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(endpoint, { method });
      if (!res.ok) throw new Error();
      const next = (await res.json()) as Status;
      setStatus(next);
      if (method === "POST" && next.url) await copy(next.url);
    } catch {
      setError(method === "POST" ? "Couldn't create the link. Try again." : "Couldn't stop sharing. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // the link is on screen to copy by hand
    }
  }

  const button: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: "0.35rem", padding: "0.45rem 0.8rem", borderRadius: 9, fontSize: "0.78rem", fontWeight: 600, cursor: busy ? "default" : "pointer", fontFamily: "inherit" };

  return (
    <div ref={panelRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{ ...button, padding: "0.3rem 0.7rem", borderRadius: 999, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(240,242,255,0.8)" }}
      >
        <Share2 size={12} /> Share
      </button>
      {open && (
        <div role="dialog" aria-label="Share this conversation" style={{ position: "absolute", right: 0, top: "calc(100% + 8px)", width: 340, zIndex: 50, padding: "1rem", borderRadius: 14, background: "#12121a", border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 16px 40px rgba(0,0,0,0.5)", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <div>
            <p style={{ fontSize: "0.9rem", fontWeight: 700, color: "#f0f2ff" }}>Share this conversation</p>
            <p style={{ fontSize: "0.76rem", lineHeight: 1.5, color: "rgba(240,242,255,0.6)", marginTop: "0.3rem" }}>
              Anyone with the link can read it as it is now — your messages, SOL&apos;s replies and the images you attached. SOL&apos;s steps show by name only, never their details.
            </p>
          </div>

          {status?.shared && status.url ? (
            <>
              <div style={{ display: "flex", gap: "0.4rem" }}>
                <input readOnly value={status.url} onFocus={(e) => e.currentTarget.select()} aria-label="Share link" style={{ flex: 1, minWidth: 0, fontSize: "0.74rem", padding: "0.45rem 0.6rem", borderRadius: 8, background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.1)", color: "#f0f2ff" }} />
                <button type="button" onClick={() => copy(status.url!)} style={{ ...button, background: "var(--brand)", border: "none", color: "#fff" }}>
                  {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <p style={{ fontSize: "0.72rem", color: "rgba(240,242,255,0.5)" }}>
                Shows messages up to {status.upTo ? new Date(status.upTo).toLocaleString() : "when it was shared"}.
              </p>
              <div style={{ display: "flex", gap: "0.5rem", justifyContent: "space-between" }}>
                <button type="button" disabled={busy} onClick={() => act("POST")} style={{ ...button, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "#f0f2ff" }}>
                  Update to include new messages
                </button>
                <button type="button" disabled={busy} onClick={() => act("DELETE")} style={{ ...button, background: "none", border: "1px solid rgba(248,113,113,0.35)", color: "#f87171" }}>
                  Stop sharing
                </button>
              </div>
            </>
          ) : (
            <button type="button" disabled={busy || !status} onClick={() => act("POST")} style={{ ...button, justifyContent: "center", background: "var(--brand)", border: "none", color: "#fff", opacity: busy || !status ? 0.6 : 1 }}>
              <Link2 size={13} /> {busy ? "Creating link…" : "Create link and copy"}
            </button>
          )}
          {error && <p style={{ fontSize: "0.74rem", color: "#f87171" }}>{error}</p>}
        </div>
      )}
    </div>
  );
}
