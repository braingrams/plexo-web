"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "../../../_components/Card";
import { Toggle } from "../../../_components/Toggle";
import { createStrataAdapter } from "@/app/dashboard/apps/_components/strataAdapter";

// The site's Brand card: which Strata brand this site uses, whether it stays in sync on its own, and what happened last — in
// plain words. Linking applies the brand to every page of the site, whatever it's made of (lib/brand/siteBrand.ts).

export type BrandState = {
  linked: boolean;
  projectId: string | null;
  projectName: string | null;
  autoSync: boolean;
  status: "active" | "needs-reconnect" | "off";
  updatedAt: string | null;
  lastCheckedAt: string | null;
  lastResult: string | null;
  lastResultKind: "updated" | "up-to-date" | "needs-review" | "error" | "reconnect" | null;
  lastSource: "webhook" | "schedule" | "owner" | null;
  useOnSite: boolean;
  canUseOnSite: boolean;
};
export type StrataProject = { id: string; name: string; color?: string | null };

const MUTED: React.CSSProperties = { fontSize: "0.8rem", color: "rgba(240,242,255,0.5)", margin: 0, lineHeight: 1.5 };
const ROW: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", padding: "0.85rem 0", borderTop: "1px solid rgba(255,255,255,0.06)" };
const BTN: React.CSSProperties = { padding: "0.55rem 0.95rem", borderRadius: 9, fontSize: "0.8rem", fontWeight: 700, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.04)", color: "rgba(240,242,255,0.88)", cursor: "pointer" };
const PRIMARY: React.CSSProperties = { ...BTN, border: "none", background: "linear-gradient(135deg,#6d5efc,#4f46e5)", color: "#fff" };

/** "just now", "2 min ago", "3 hours ago", "on 4 Nov". */
export function timeAgo(iso: string | null, now = Date.now()): string {
  if (!iso) return "";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} day${d === 1 ? "" : "s"} ago`;
  return `on ${new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
}

/** The one line that says what happened, e.g. "Updated 2 min ago from Strata". */
export function brandHeadline(state: BrandState, now = Date.now()): { text: string; tone: "ok" | "warn" | "bad" } {
  if (state.status === "needs-reconnect" || state.lastResultKind === "reconnect") return { text: "Plexo lost access to this brand in Strata. Link it again to keep it up to date.", tone: "bad" };
  if (state.lastResultKind === "needs-review") return { text: state.lastResult ?? "Strata has changes that need a look before they go live.", tone: "warn" };
  if (state.lastResultKind === "error") return { text: state.lastResult ?? "Couldn't reach Strata just now. Plexo will try again shortly.", tone: "warn" };
  const when = timeAgo(state.updatedAt, now);
  return { text: when ? `Updated ${when} from Strata${state.lastSource === "webhook" ? " when it was published" : ""}.` : "Your brand from Strata is on your site.", tone: "ok" };
}

export function SiteBrandPanel({ templateId, sourceType }: { templateId: string; sourceType: string }) {
  const strata = useMemo(() => createStrataAdapter(), []);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [state, setState] = useState<BrandState | null>(null);
  const [connected, setConnected] = useState(false);
  const [projects, setProjects] = useState<StrataProject[] | null>(null);
  const [choice, setChoice] = useState("");
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const path = `/api/v1/sites/${encodeURIComponent(templateId)}/brand`;
  const isRaw = sourceType === "RAW_UPLOAD";

  const call = useCallback(async (init?: { method: string; body?: unknown }) => {
    const res = await fetch(path, { method: init?.method ?? "GET", headers: init?.body ? { "Content-Type": "application/json" } : undefined, body: init?.body ? JSON.stringify(init.body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? "Something went wrong. Please try again.");
    return data as BrandState;
  }, [path]);

  useEffect(() => {
    let cancelled = false;
    strata.available().then(async (on) => {
      if (cancelled) return;
      setAvailable(on);
      if (!on) return;
      const [s, status] = await Promise.all([call(), strata.status().catch(() => ({ connected: false }))]);
      if (cancelled) return;
      setState(s);
      setConnected(status.connected);
    }).catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Couldn't load your brand."));
    return () => {
      cancelled = true;
    };
  }, [strata, call]);

  const run = async (label: string, fn: () => Promise<BrandState | void>) => {
    setBusy(label);
    setError(null);
    try {
      const next = await fn();
      if (next) setState(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const startPicking = () => run("pick", async () => {
    if (!connected) {
      const s = await strata.connect();
      setConnected(s.connected);
      if (!s.connected) return;
    }
    const list = await strata.listProjects();
    setProjects(list);
    setChoice(list.find((p) => p.id === state?.projectId)?.id ?? list[0]?.id ?? "");
    setPicking(true);
  });

  const link = () => run("link", async () => {
    const project = projects?.find((p) => p.id === choice);
    if (!project) throw new Error("Choose a brand first.");
    const next = await call({ method: "POST", body: { projectId: project.id, projectName: project.name, autoSync: true } });
    setPicking(false);
    return next;
  });

  if (available === false) return null;

  const headline = state?.linked ? brandHeadline(state) : null;
  const toneColor = headline?.tone === "bad" ? "#f87171" : headline?.tone === "warn" ? "#fbbf24" : "#4ade80";

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem", marginBottom: "0.9rem" }}>
        <div>
          <h2 style={{ fontSize: "0.95rem", fontWeight: 700, color: "#f0f2ff", margin: "0 0 0.3rem" }}>Brand</h2>
          <p style={MUTED}>Use your brand from Strata on every page of this site. When you publish a change in Strata, your site changes too.</p>
        </div>
        {state?.linked && !picking && (
          <button type="button" style={BTN} onClick={startPicking} disabled={busy !== null}>
            {busy === "pick" ? "Opening…" : "Change brand"}
          </button>
        )}
      </div>

      {!state && !error && <p style={MUTED}>Loading…</p>}

      {state && !state.linked && !picking && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
          <button type="button" style={PRIMARY} onClick={startPicking} disabled={busy !== null}>
            {busy === "pick" ? "Opening…" : connected ? "Choose a brand" : "Connect Strata"}
          </button>
          <span style={MUTED}>{connected ? "Pick the Strata project with your colours, fonts and buttons." : "Sign in with your Charisol account to pick your brand."}</span>
        </div>
      )}

      {picking && projects && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
          {projects.length === 0 ? (
            <p style={MUTED}>You don&apos;t have any brands in Strata yet. Create one in Strata, then come back.</p>
          ) : (
            <>
              <select value={choice} onChange={(e) => setChoice(e.target.value)} style={{ ...BTN, minWidth: 220, fontWeight: 600 }} aria-label="Brand">
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <button type="button" style={PRIMARY} onClick={link} disabled={busy !== null || !choice}>
                {busy === "link" ? "Applying to your site…" : "Use this brand"}
              </button>
            </>
          )}
          <button type="button" style={{ ...BTN, background: "transparent", border: "none" }} onClick={() => setPicking(false)} disabled={busy !== null}>
            Cancel
          </button>
        </div>
      )}

      {state?.linked && !picking && headline && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.75rem 0.9rem", borderRadius: 10, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", marginBottom: "0.4rem" }}>
            <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: toneColor, flexShrink: 0 }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: "0.85rem", fontWeight: 700, color: "#f0f2ff" }}>{state.projectName ?? "Your Strata brand"}</div>
              <div style={{ ...MUTED, color: headline.tone === "ok" ? "rgba(240,242,255,0.55)" : toneColor }}>{headline.text}</div>
            </div>
          </div>

          <div style={ROW}>
            <div>
              <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "#f0f2ff" }}>Keep in sync with Strata</div>
              <p style={MUTED}>{state.autoSync ? "Changes you publish in Strata appear on your site within a couple of minutes." : "Your site keeps its current brand until you turn this back on."}</p>
            </div>
            <Toggle checked={state.autoSync} disabled={busy !== null || state.status !== "active"} label="Keep in sync with Strata" onChange={(on) => run("sync", () => call({ method: "PATCH", body: { autoSync: on } }))} />
          </div>

          {isRaw && (
            <div style={ROW}>
              <div>
                <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "#f0f2ff" }}>Use my brand on this site</div>
                <p style={MUTED}>
                  {state.canUseOnSite
                    ? "Your site's main colours and fonts are swapped for your brand's. Turn it off to see the original look again — nothing is lost."
                    : "Plexo can match your site's main colours and fonts to your brand."}
                </p>
              </div>
              {state.canUseOnSite ? (
                <Toggle checked={state.useOnSite} disabled={busy !== null} label="Use my brand on this site" onChange={(on) => run("use", () => call({ method: "PATCH", body: { useOnSite: on } }))} />
              ) : (
                <button type="button" style={BTN} disabled={busy !== null} onClick={() => run("apply", () => call({ method: "PATCH", body: { applyBrand: true } }))}>
                  {busy === "apply" ? "Matching…" : "Apply my brand"}
                </button>
              )}
            </div>
          )}

          <div style={{ ...ROW, paddingBottom: 0 }}>
            <button type="button" style={BTN} disabled={busy !== null} onClick={() => (state.status === "needs-reconnect" ? startPicking() : run("now", () => call({ method: "PATCH", body: { syncNow: true } })))}>
              {busy === "now" ? "Checking…" : state.status === "needs-reconnect" ? "Link again" : "Check Strata now"}
            </button>
            <button
              type="button"
              style={{ ...BTN, background: "transparent", color: "rgba(248,113,113,0.9)", border: "1px solid rgba(248,113,113,0.25)" }}
              disabled={busy !== null}
              onClick={() => {
                if (window.confirm("Stop using this brand? Your pages go back to the colours and fonts they were built with.")) void run("unlink", () => call({ method: "DELETE" }));
              }}
            >
              {busy === "unlink" ? "Removing…" : "Stop using this brand"}
            </button>
          </div>
        </>
      )}

      {error && <p role="alert" style={{ ...MUTED, color: "#f87171", marginTop: "0.75rem" }}>{error}</p>}
    </Card>
  );
}
