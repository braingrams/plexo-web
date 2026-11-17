"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Link2 } from "lucide-react";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";

type Status = { shared: boolean; url: string | null; upTo: string | null };

/** Share a conversation: a read-only link to it as it is now (lib/sol/share.ts). */
export function ShareDialog({ conversationId, onClose }: { conversationId: string | null; onClose: () => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const endpoint = conversationId ? `/api/v1/sol/conversations/${conversationId}/share` : null;

  useEffect(() => {
    if (!endpoint) return;
    setStatus(null);
    setError(null);
    setCopied(false);
    fetch(endpoint)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setStatus)
      .catch(() => setError("We couldn't check whether this chat is shared. Please try again."));
  }, [endpoint]);

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 4000);
    } catch {
      // the link is on screen to copy by hand
    }
  }
  async function act(method: "POST" | "DELETE") {
    if (!endpoint) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(endpoint, { method });
      if (!res.ok) throw new Error();
      const next = (await res.json()) as Status;
      setStatus(next);
      if (method === "POST" && next.url) await copy(next.url);
    } catch {
      setError(method === "POST" ? "We couldn't make the link. Please try again." : "We couldn't turn sharing off. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={!!conversationId}
      onClose={onClose}
      width={480}
      title="Share this chat"
      description="Anyone with the link can read the chat as it is now: your messages, SOL's replies and the pictures you added. SOL's steps show by name only."
      footer={
        status?.shared && status.url ? (
          <>
            <Button variant="ghost" loading={busy} onClick={() => void act("DELETE")}>
              Stop sharing
            </Button>
            <Button variant="secondary" loading={busy} onClick={() => void act("POST")}>
              Add new messages
            </Button>
          </>
        ) : (
          <Button loading={busy} disabled={!status} leftIcon={<Link2 size={18} aria-hidden />} onClick={() => void act("POST")}>
            Create link and copy
          </Button>
        )
      }
    >
      {status?.shared && status.url ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <input className="plx-input" readOnly value={status.url} aria-label="Share link" onFocus={(e) => e.currentTarget.select()} style={{ flex: 1, minWidth: 0 }} />
            <Button variant="strong" leftIcon={copied ? <Check size={18} aria-hidden /> : <Copy size={18} aria-hidden />} onClick={() => void copy(status.url!)}>
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="plx-small" role="status">
            {copied ? "Link copied. Paste it anywhere to share." : `Shows messages up to ${status.upTo ? new Date(status.upTo).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "when you shared it"}.`}
          </p>
        </div>
      ) : null}
      {error ? <p className="sol3-error" role="alert">{error}</p> : null}
    </Modal>
  );
}
