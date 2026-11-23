"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, Download, FileText, ThumbsDown, ThumbsUp } from "lucide-react";
import { Button } from "../ui/Button";

type Format = "pdf" | "docx" | "html";
const FORMATS: Array<{ format: Format; label: string }> = [
  { format: "pdf", label: "Save as PDF" },
  { format: "docx", label: "Save as Word file" },
  { format: "html", label: "Save as web page" },
];

/** Under each SOL reply: copy, rate, save. */
export function MessageTools({ text, messageId, conversationId, initialFeedback }: { text: string; messageId: string; conversationId: string; initialFeedback?: "UP" | "DOWN" | null }) {
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<"UP" | "DOWN" | null>(initialFeedback ?? null);
  const [asking, setAsking] = useState(false);
  const [comment, setComment] = useState("");
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState<Format | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setMenu(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  async function rate(rating: "UP" | "DOWN", note?: string) {
    setFeedback(rating);
    try {
      await fetch("/api/v1/sol/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messageId, threadId: conversationId, rating, comment: note || undefined }) });
    } catch {
      // Best-effort: a failed rating should never get in the way of the chat.
    }
  }
  async function save(format: Format) {
    setBusy(format);
    setError(null);
    try {
      const params = new URLSearchParams({ format, messageId });
      const res = await fetch(`/api/v1/sol/conversations/${conversationId}/export?${params.toString()}`);
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const name = (res.headers.get("Content-Disposition") || "").match(/filename="([^"]+)"/)?.[1] || `sol-reply.${format}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setMenu(false);
    } catch {
      setError("We couldn't save that. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="sol3-tools" ref={wrap} style={{ position: "relative" }}>
        <button type="button" className="plx-iconbtn" aria-label={copied ? "Copied" : "Copy this reply"} data-on={copied} onClick={() => navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {})}>
          {copied ? <Check size={17} aria-hidden /> : <Copy size={17} aria-hidden />}
        </button>
        <button type="button" className="plx-iconbtn" aria-label="Good reply" aria-pressed={feedback === "UP"} data-on={feedback === "UP"} onClick={() => { setAsking(false); void rate("UP"); }}>
          <ThumbsUp size={17} aria-hidden />
        </button>
        <button type="button" className="plx-iconbtn" aria-label="Not a good reply" aria-pressed={feedback === "DOWN"} data-on={feedback === "DOWN"} onClick={() => { setAsking(true); void rate("DOWN"); }}>
          <ThumbsDown size={17} aria-hidden />
        </button>
        <button type="button" className="plx-iconbtn" aria-label="Save this reply" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((v) => !v)}>
          <Download size={17} aria-hidden />
        </button>
        {menu ? (
          <div className="sol3-pop" role="menu" style={{ left: 0, right: "auto", top: "100%" }}>
            {FORMATS.map((f) => (
              <button key={f.format} type="button" role="menuitem" disabled={busy !== null} onClick={() => void save(f.format)}>
                <FileText size={17} aria-hidden /> {busy === f.format ? "Saving…" : f.label}
              </button>
            ))}
            {error ? <p className="plx-small" style={{ margin: "4px 12px 8px", color: "var(--plx-danger)" }}>{error}</p> : null}
          </div>
        ) : null}
      </div>
      {asking ? (
        <div className="sol3-card" style={{ padding: 14, gap: 10, maxWidth: 420 }}>
          <textarea className="plx-input" rows={2} placeholder="What did you expect instead? (optional)" value={comment} onChange={(e) => setComment(e.target.value)} style={{ minHeight: 64, padding: 10, resize: "none" }} />
          <div className="sol3-actions" style={{ justifyContent: "flex-end" }}>
            <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>Skip</Button>
            <Button size="sm" onClick={() => { void rate("DOWN", comment); setAsking(false); }}>Send</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
