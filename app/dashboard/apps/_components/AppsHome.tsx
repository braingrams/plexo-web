"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUp, Sparkles } from "lucide-react";
import { api, ApiError } from "./api";
import { C, timeAgo } from "./ui";
import { PageContainer } from "../../_components/PageContainer";

const IDEAS = [
  "A booking app for my salon with staff calendars and reminders",
  "A CRM to track leads, deals and follow-ups for my team",
  "A members-only portal with paid courses and progress tracking",
  "An internal tool to manage inventory with barcode lookup",
  "A marketplace where local artists sell their work",
  "A habit tracker with streaks, reminders and charts",
];

/** A short, sensible starting name from what someone typed (they can rename it anytime). */
function nameFrom(prompt: string): string {
  const words = prompt
    .replace(/^(build|make|create)\s+(me\s+)?(an?\s+)?/i, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    .join(" ")
    .replace(/[^\w\s-]/g, "");
  return words ? words[0].toUpperCase() + words.slice(1) : "My App";
}

export function AppsHome(props: { apps: Array<{ id: string; name: string; previewUrl: string | null; published: boolean; updatedAt: string | null }>; userName: string | null }) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(text: string) {
    const idea = text.trim();
    if (!idea || creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await api<{ id: string }>("/api/v1/apps", { method: "POST", json: { name: nameFrom(idea) } });
      router.push(`/dashboard/apps/${res.id}?prompt=${encodeURIComponent(idea)}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create the app. Please try again.");
      setCreating(false);
    }
  }

  return (
    <PageContainer>
      <div style={{ maxWidth: 760, margin: "2rem auto 2.5rem", textAlign: "center" }}>
        <h1 style={{ fontSize: "clamp(1.6rem, 3vw, 2.2rem)", fontWeight: 800, margin: "0 0 0.5rem" }}>{props.userName ? `What are we building, ${props.userName}?` : "What are we building?"}</h1>
        <p style={{ color: "var(--text-muted, rgba(240,242,255,0.6))", margin: "0 0 1.4rem" }}>
          Describe your app. Plexo builds it — pages, database, sign-in and all — and you can keep shaping it by chatting or editing the code.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void create(prompt);
          }}
          style={{ position: "relative", textAlign: "left" }}
        >
          <textarea
            aria-label="Describe your app"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void create(prompt);
              }
            }}
            rows={3}
            placeholder="A booking app for my studio where clients pick a time and pay a deposit…"
            style={{ width: "100%", resize: "vertical", padding: "1rem 3.4rem 1rem 1rem", borderRadius: 16, border: `1px solid ${C.borderStrong}`, background: "rgba(255,255,255,0.04)", color: C.text, fontSize: "0.95rem", lineHeight: 1.5, outline: "none" }}
          />
          <button type="submit" aria-label="Build it" disabled={!prompt.trim() || creating} style={{ position: "absolute", right: 12, bottom: 14, width: 38, height: 38, borderRadius: 12, border: "none", cursor: prompt.trim() && !creating ? "pointer" : "default", background: prompt.trim() ? `linear-gradient(135deg, ${C.brand}, ${C.brandDeep})` : "rgba(255,255,255,0.08)", color: "#fff", display: "grid", placeItems: "center" }}>
            {creating ? "…" : <ArrowUp size={18} />}
          </button>
        </form>
        {error && <p style={{ color: C.danger, fontSize: "0.82rem" }}>{error}</p>}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", marginTop: 14 }}>
          {IDEAS.map((idea) => (
            <button key={idea} type="button" onClick={() => setPrompt(idea)} style={{ padding: "0.42rem 0.75rem", borderRadius: 999, border: `1px solid ${C.border}`, background: "rgba(255,255,255,0.03)", color: "rgba(240,242,255,0.75)", fontSize: "0.76rem", cursor: "pointer", display: "inline-flex", gap: 6, alignItems: "center" }}>
              <Sparkles size={12} /> {idea}
            </button>
          ))}
        </div>
      </div>

      {props.apps.length > 0 && (
        <section>
          <h2 style={{ fontSize: "1rem", fontWeight: 700, margin: "0 0 0.8rem" }}>Your apps</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
            {props.apps.map((app) => (
              <Link key={app.id} href={`/dashboard/apps/${app.id}`} style={{ textDecoration: "none", color: "inherit", padding: "1rem", borderRadius: 14, border: `1px solid ${C.border}`, background: "rgba(255,255,255,0.025)", display: "flex", flexDirection: "column", gap: 6 }}>
                <strong style={{ fontSize: "0.92rem" }}>{app.name}</strong>
                <span style={{ fontSize: "0.74rem", color: app.published ? C.success : C.muted }}>{app.published ? "● Live" : "Not published yet"}</span>
                <span style={{ fontSize: "0.72rem", color: C.faint }}>Edited {timeAgo(app.updatedAt)}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </PageContainer>
  );
}
