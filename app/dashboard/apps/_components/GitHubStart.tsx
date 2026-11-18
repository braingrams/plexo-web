"use client";

import { useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { api, ApiError } from "./api";
import { GitHubPane } from "./GitHubPane";
import { ink, muted, surface, border, fill, brandGradient } from "./appPlan";

// The "Connect a GitHub project" path in the new-app wizard. Step 1 names the app and creates it
// as a draft (GitHub must know which app to connect, so the app has to exist first). Step 2 is
// the GitHub pane: install the Plexo GitHub app if needed, pick the project, and bring its code in.

const primary = (enabled: boolean): CSSProperties => ({
  display: "inline-flex", alignItems: "center", gap: 8, fontFamily: "inherit", fontSize: 15, fontWeight: 700, padding: "14px 24px", borderRadius: 13, border: "none",
  background: enabled ? brandGradient : fill(14), color: enabled ? "var(--ed-on-brand)" : muted, cursor: enabled ? "pointer" : "default",
});
const linkButton: CSSProperties = { background: "none", border: "none", padding: 0, fontFamily: "inherit", fontSize: 13.5, color: "var(--ed-accent-text)", cursor: "pointer" };

export function GitHubStart(props: { onCancel: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [appId, setAppId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createDraft() {
    if (creating || !name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      // build: false — there's no code yet, so no first preview build is needed.
      const res = await api<{ id: string }>("/api/v1/apps", { method: "POST", json: { name: name.trim(), build: false } });
      setAppId(res.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We couldn't start your app. Please try again.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <section className="ah-fade" style={{ display: "flex", flexDirection: "column", gap: 22, borderRadius: 22, border: `1px solid ${border}`, background: surface, padding: "clamp(20px, 5vw, 32px) clamp(18px, 5vw, 36px)", color: ink }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <button type="button" onClick={props.onCancel} aria-label="Back" style={{ ...linkButton, color: muted, display: "inline-flex" }}><ArrowLeft size={20} /></button>
        <div style={{ fontSize: 13, fontWeight: 700, color: muted }}>{appId ? "Step 2 of 2" : "Step 1 of 2"}</div>
      </div>

      {!appId ? (
        <>
          <div>
            <div style={{ fontSize: "clamp(21px, 5.6vw, 30px)", fontWeight: 800, letterSpacing: "-0.02em" }}>What&rsquo;s the app called?</div>
            <div style={{ fontSize: "clamp(13.5px, 3.7vw, 15px)", color: muted, marginTop: 6 }}>You can change the name later.</div>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void createDraft();
            }}
            style={{ display: "flex", flexDirection: "column", gap: 16 }}
          >
            <input
              autoFocus
              aria-label="App name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My app"
              maxLength={80}
              style={{ width: "100%", boxSizing: "border-box", padding: "14px 16px", borderRadius: 13, border: `1px solid ${border}`, background: surface, color: ink, fontSize: 16, fontFamily: "inherit" }}
            />
            {error && <p role="alert" style={{ margin: 0, fontSize: 13.5, color: "var(--ed-danger)" }}>{error}</p>}
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <button type="submit" disabled={!name.trim() || creating} style={primary(!!name.trim() && !creating)}>
                {creating ? <><Loader2 size={16} className="ah-spin" /> Creating…</> : "Continue"}
              </button>
              <button type="button" onClick={props.onCancel} style={{ ...linkButton, color: muted }}>Cancel</button>
            </div>
          </form>
        </>
      ) : (
        <>
          <div>
            <div style={{ fontSize: "clamp(21px, 5.6vw, 30px)", fontWeight: 800, letterSpacing: "-0.02em" }}>Pick your GitHub project</div>
            <div style={{ fontSize: "clamp(13.5px, 3.7vw, 15px)", color: muted, marginTop: 6 }}>
              If GitHub asks you to approve the Plexo app, you&rsquo;ll be taken to this app&rsquo;s GitHub tab to pick the project once you&rsquo;re back.
            </div>
          </div>
          <GitHubPane appId={appId} onLinked={() => router.push(`/dashboard/apps/${appId}`)} />
          <div style={{ fontSize: 13, color: muted }}>
            Changed your mind? Your app is saved as a draft. Find it under All apps.
          </div>
        </>
      )}
    </section>
  );
}
