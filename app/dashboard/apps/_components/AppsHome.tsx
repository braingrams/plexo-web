"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUp, Database, Globe, KeyRound, LayoutTemplate, Code2 } from "lucide-react";
import { api, ApiError } from "./api";
import { C, timeAgo } from "./ui";
import { PageContainer } from "../../_components/PageContainer";

const INCLUDED = [
  { icon: LayoutTemplate, title: "Pages and design", body: "Built from your description; refine by chat, in the Design tab, or in code." },
  { icon: Database, title: "A real database", body: "Postgres with safe access rules, a table viewer and a SQL editor." },
  { icon: KeyRound, title: "Sign-in for your users", body: "Email and password, magic links and Google — no setup." },
  { icon: Code2, title: "Your code, yours", body: "Edit every file in Code mode and sync both ways with GitHub." },
  { icon: Globe, title: "One-click publish", body: "A free address straight away, or connect your own domain." },
];

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
      <header style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.6rem", fontWeight: 800, margin: "0 0 0.35rem" }}>{props.userName ? `What are we building, ${props.userName}?` : "What are we building?"}</h1>
        <p style={{ color: "var(--text-muted, rgba(240,242,255,0.6))", margin: 0, maxWidth: 760 }}>
          Describe your app. Plexo builds it — pages, database, sign-in and all — and you keep shaping it by chatting, designing or editing the code.
        </p>
      </header>

      <div className="apps-home-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 380px", gap: 24, alignItems: "start", marginBottom: "2.25rem" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void create(prompt);
            }}
            style={{ position: "relative" }}
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
              rows={6}
              placeholder="A booking app for my studio where clients pick a time and pay a deposit…"
              style={{ width: "100%", resize: "vertical", padding: "1rem 3.6rem 1rem 1rem", borderRadius: 16, border: `1px solid ${C.borderStrong}`, background: "rgba(255,255,255,0.04)", color: C.text, fontSize: "0.95rem", lineHeight: 1.55, outline: "none" }}
            />
            <button type="submit" aria-label="Build it" disabled={!prompt.trim() || creating} style={{ position: "absolute", right: 12, bottom: 14, width: 40, height: 40, borderRadius: 12, border: "none", cursor: prompt.trim() && !creating ? "pointer" : "default", background: prompt.trim() ? `linear-gradient(135deg, ${C.brand}, ${C.brandDeep})` : "rgba(255,255,255,0.08)", color: "#fff", display: "grid", placeItems: "center" }}>
              {creating ? "…" : <ArrowUp size={18} />}
            </button>
          </form>
          {error && <p style={{ color: C.danger, fontSize: "0.82rem", margin: 0 }}>{error}</p>}
          <div>
            <p style={{ margin: "0 0 0.5rem", fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: C.faint }}>Start from an idea</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 8 }}>
              {IDEAS.map((idea) => (
                <button key={idea} type="button" onClick={() => setPrompt(idea)} style={{ padding: "0.6rem 0.8rem", borderRadius: 12, border: `1px solid ${C.border}`, background: "rgba(255,255,255,0.03)", color: "rgba(240,242,255,0.8)", fontSize: "0.8rem", lineHeight: 1.4, cursor: "pointer", textAlign: "left" }}>
                  {idea}
                </button>
              ))}
            </div>
          </div>
        </div>

        <aside style={{ borderRadius: 16, border: `1px solid ${C.border}`, background: "rgba(255,255,255,0.025)", padding: "1.1rem 1.2rem", display: "flex", flexDirection: "column", gap: 14 }}>
          <p style={{ margin: 0, fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: C.faint }}>Every app comes with</p>
          {INCLUDED.map(({ icon: Icon, title, body }) => (
            <div key={title} style={{ display: "flex", gap: 12 }}>
              <Icon size={18} color={C.brand} style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <div style={{ fontSize: "0.86rem", fontWeight: 650 }}>{title}</div>
                <div style={{ fontSize: "0.78rem", color: C.muted, lineHeight: 1.45 }}>{body}</div>
              </div>
            </div>
          ))}
        </aside>
      </div>

      {props.apps.length > 0 && (
        <section>
          <h2 style={{ fontSize: "1rem", fontWeight: 700, margin: "0 0 0.8rem" }}>Your apps · {props.apps.length}</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
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
      <style>{`@media (max-width: 1000px) { .apps-home-grid { grid-template-columns: minmax(0, 1fr) !important; } }`}</style>
    </PageContainer>
  );
}
