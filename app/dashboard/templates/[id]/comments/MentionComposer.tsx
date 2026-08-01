"use client";

import { useEffect, useRef, useState } from "react";

type OrgMember = { id: string; name: string; email: string; image: string | null };

/**
 * Plain-text textarea with @mention autocomplete. Keeps the visible text human-readable
 * while typing ("@Jane") and only serializes to the stored `@[Jane](userId:<uuid>)` token
 * format on submit — see lib/comments/mentions.ts. Known simplification: if two members
 * share the exact same display name, whichever was selected last "wins" for that name at
 * submit time (a Map<name, userId> is used, not per-occurrence tracking).
 */
export function MentionComposer({
  placeholder,
  autoFocus,
  onSubmit,
  onCancel,
  submitLabel = "Comment",
}: {
  placeholder: string;
  autoFocus?: boolean;
  onSubmit: (serializedBody: string) => Promise<void> | void;
  onCancel?: () => void;
  submitLabel?: string;
}) {
  const [text, setText] = useState("");
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [query, setQuery] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const mentionMapRef = useRef<Map<string, string>>(new Map());
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (query === null) return;
    const controller = new AbortController();
    fetch(`/api/v1/organizations/active/members?q=${encodeURIComponent(query)}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((data) => setMembers(data.members ?? []))
      .catch(() => {});
    return () => controller.abort();
  }, [query]);

  function handleChange(value: string) {
    setText(value);
    const cursor = textareaRef.current?.selectionStart ?? value.length;
    const uptoCursor = value.slice(0, cursor);
    const match = uptoCursor.match(/(?:^|\s)@([a-zA-Z0-9._-]*)$/);
    setQuery(match ? match[1] : null);
  }

  function selectMember(member: OrgMember) {
    const cursor = textareaRef.current?.selectionStart ?? text.length;
    const uptoCursor = text.slice(0, cursor);
    const match = uptoCursor.match(/(?:^|\s)@([a-zA-Z0-9._-]*)$/);
    if (!match) return;
    const start = cursor - match[0].length + (match[0].startsWith(" ") ? 1 : 0);
    const before = text.slice(0, start);
    const after = text.slice(cursor);
    mentionMapRef.current.set(member.name.toLowerCase(), member.id);
    const inserted = `@${member.name} `;
    setText(`${before}${inserted}${after}`);
    setQuery(null);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  async function handleSubmit() {
    const trimmed = text.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      // Serialize @Name occurrences that match a resolved mention into the stored token
      // format — only names actually selected from the dropdown are converted, so a
      // literal "@" a user typed without picking anyone stays as plain text.
      let serialized = trimmed;
      for (const [name, userId] of mentionMapRef.current.entries()) {
        const re = new RegExp(`@${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=\\s|$)`, "gi");
        serialized = serialized.replace(re, (m) => `@[${m.slice(1)}](userId:${userId})`);
      }
      await onSubmit(serialized);
      setText("");
      mentionMapRef.current.clear();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ position: "relative" }}>
      <textarea
        ref={textareaRef}
        autoFocus={autoFocus}
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && query === null) {
            e.preventDefault();
            void handleSubmit();
          }
          if (e.key === "Escape") onCancel?.();
        }}
        placeholder={placeholder}
        rows={3}
        style={{
          width: "100%", background: "#090d16", border: "1px solid rgba(255,255,255,0.09)",
          borderRadius: 10, padding: "0.6rem 0.75rem", color: "#f0f2ff", fontSize: "0.82rem",
          resize: "none", fontFamily: "inherit",
        }}
      />

      {query !== null && members.length > 0 && (
        <div style={{
          position: "absolute", bottom: "100%", left: 0, marginBottom: 4, width: 220,
          background: "rgba(13,15,26,0.98)", border: "1px solid rgba(255,255,255,0.09)",
          borderRadius: 10, boxShadow: "0 12px 30px rgba(0,0,0,0.5)", zIndex: 80, padding: "0.3rem",
          maxHeight: 180, overflowY: "auto",
        }}>
          {members.map((m) => (
            <button
              key={m.id}
              onClick={() => selectMember(m)}
              style={{
                display: "block", width: "100%", textAlign: "left", padding: "0.4rem 0.5rem",
                borderRadius: 8, border: "none", background: "transparent", color: "#f0f2ff",
                fontSize: "0.78rem", cursor: "pointer",
              }}
            >
              {m.name} <span style={{ color: "rgba(240,242,255,0.4)" }}>{m.email}</span>
            </button>
          ))}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "0.5rem" }}>
        {onCancel && (
          <button
            onClick={onCancel}
            style={{ background: "none", border: "none", color: "rgba(240,242,255,0.5)", fontSize: "0.78rem", cursor: "pointer" }}
          >
            Cancel
          </button>
        )}
        <button
          onClick={() => void handleSubmit()}
          disabled={submitting || !text.trim()}
          style={{
            background: "var(--brand)", border: "none", borderRadius: 8, padding: "0.4rem 0.9rem",
            color: "#fff", fontWeight: 700, fontSize: "0.78rem",
            cursor: submitting ? "not-allowed" : "pointer", opacity: submitting ? 0.6 : 1,
          }}
        >
          {submitting ? "Posting…" : submitLabel}
        </button>
      </div>
    </div>
  );
}
