"use client";

import { useState } from "react";
import Link from "next/link";

/** Intermediate-level admins get a nudge, not a wizard — a dismissible checklist that
 * links into each relevant section, checked off as completed, rather than blocking
 * navigation the way Beginner's wizard does. See the Funnel/LMS plan's
 * "Experience-level onboarding" section. */
export function SetupChecklist({
  templateId, hasPage, enabled, signupConfigured,
}: { templateId: string; hasPage: boolean; enabled: boolean; signupConfigured: boolean }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  const base = `/dashboard/funnels/${templateId}`;
  const items = [
    { label: "Add a page", done: hasPage, href: `${base}/pages` },
    { label: "Set up how people sign up", done: signupConfigured, href: `${base}/settings` },
    { label: "Publish", done: enabled, href: `${base}/settings` },
  ];

  if (items.every((i) => i.done)) return null;

  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap",
      background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12,
      padding: "0.85rem 1.1rem", marginBottom: "1.25rem",
    }}>
      <div style={{ display: "flex", gap: "1.25rem", flexWrap: "wrap" }}>
        {items.map((item) => (
          <Link
            key={item.label}
            href={item.href}
            style={{ display: "flex", alignItems: "center", gap: "0.45rem", fontSize: "0.82rem", textDecoration: "none", color: item.done ? "rgba(240,242,255,0.4)" : "#f0f2ff" }}
          >
            <span style={{
              width: 16, height: 16, borderRadius: "50%", flexShrink: 0, display: "grid", placeItems: "center",
              background: item.done ? "rgba(52,211,153,0.18)" : "rgba(255,255,255,0.06)",
              border: item.done ? "none" : "1px solid rgba(255,255,255,0.2)",
            }}>
              {item.done && (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
              )}
            </span>
            <span style={{ textDecoration: item.done ? "line-through" : "none" }}>{item.label}</span>
          </Link>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        style={{ background: "none", border: "none", color: "rgba(240,242,255,0.35)", cursor: "pointer", fontSize: "0.78rem" }}
      >
        Dismiss
      </button>
    </div>
  );
}
