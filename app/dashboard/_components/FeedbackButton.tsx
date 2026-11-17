"use client";

import { openFeedback } from "@/lib/struggle/events";

function IconFeedback() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

/** The always-there "Feedback" button in both shells' menus. It opens the same short form
 * the "Having an issue?" nudge opens (<FeedbackNudge />, mounted once in app/dashboard/layout.tsx). */
export function FeedbackButton() {
  return (
    <button
      type="button"
      onClick={openFeedback}
      aria-label="Feedback"
      title="Feedback: tell us what is not working"
      style={{
        background: "none", border: "none", cursor: "pointer",
        color: "var(--color-text-primary, var(--text-main, var(--plx-text, #f0f2ff)))", padding: "0.4rem", borderRadius: 8, display: "flex", alignItems: "center",
      }}
    >
      <IconFeedback />
    </button>
  );
}
