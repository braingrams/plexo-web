"use client";

import { useState } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";

export function FeedbackControls({
  messageId,
  conversationId,
  initialFeedback,
}: {
  messageId: string;
  conversationId: string;
  initialFeedback?: "UP" | "DOWN" | null;
}) {
  const [feedback, setFeedback] = useState<"UP" | "DOWN" | null>(initialFeedback ?? null);
  const [showComment, setShowComment] = useState(false);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function submit(rating: "UP" | "DOWN", commentText?: string) {
    setSubmitting(true);
    try {
      await fetch("/api/v1/sol/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId, threadId: conversationId, rating, comment: commentText || undefined }),
      });
      setFeedback(rating);
      setSubmitted(true);
    } catch {
      // Best-effort — feedback failing silently is preferable to blocking the chat UI.
    } finally {
      setSubmitting(false);
    }
  }

  function handleThumbsUp() {
    if (submitting) return;
    setShowComment(false);
    void submit("UP");
  }

  function handleThumbsDown() {
    if (submitting) return;
    if (feedback === "DOWN" && submitted) {
      setShowComment((v) => !v);
      return;
    }
    setShowComment(true);
    void submit("DOWN");
  }

  const btnStyle = (active: boolean): React.CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 26,
    height: 26,
    borderRadius: 7,
    border: "none",
    background: active ? "var(--brand-subtle)" : "transparent",
    color: active ? "var(--brand)" : "rgba(240,242,255,0.4)",
    cursor: submitting ? "not-allowed" : "pointer",
  });

  return (
    <div style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: "0.15rem" }}>
      <button type="button" aria-label="Good response" onClick={handleThumbsUp} disabled={submitting} style={btnStyle(feedback === "UP")}>
        <ThumbsUp size={13} />
      </button>
      <button type="button" aria-label="Bad response" onClick={handleThumbsDown} disabled={submitting} style={btnStyle(feedback === "DOWN")}>
        <ThumbsDown size={13} />
      </button>

      {showComment && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 0.4rem)",
            left: 0,
            zIndex: 20,
            width: 260,
            background: "rgba(13,15,26,0.98)",
            border: "1px solid rgba(255,255,255,0.09)",
            borderRadius: 12,
            boxShadow: "0 20px 50px -10px rgba(0,0,0,0.6)",
            padding: "0.6rem",
          }}
        >
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="What went wrong? (optional)"
            rows={2}
            style={{
              width: "100%",
              resize: "none",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 8,
              padding: "0.4rem 0.5rem",
              color: "#f0f2ff",
              fontSize: "0.76rem",
              fontFamily: "inherit",
              marginBottom: "0.4rem",
            }}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.4rem" }}>
            <button
              type="button"
              onClick={() => setShowComment(false)}
              style={{ background: "none", border: "none", color: "rgba(240,242,255,0.5)", fontSize: "0.72rem", cursor: "pointer", fontFamily: "inherit" }}
            >
              Dismiss
            </button>
            <button
              type="button"
              onClick={() => {
                void submit("DOWN", comment);
                setShowComment(false);
              }}
              style={{
                background: "var(--brand-subtle)",
                border: "none",
                borderRadius: 6,
                padding: "0.25rem 0.6rem",
                color: "var(--brand)",
                fontSize: "0.72rem",
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
