"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowLeftRight, ArrowUpRight, Clock, Download, ExternalLink, GitBranch, Link2Off, RefreshCw, Upload } from "lucide-react";
import { api, ApiError } from "./api";
import { C, Button, Notice, PaneHeader, Pill, ProblemState, Shimmer, StateStyles, EmptyHero, StatCard, inputStyle, timeAgo } from "./ui";

import { BRAND } from "@/lib/theme";
// Two-way GitHub sync: every Plexo version becomes a commit, and pushes to the branch come
// back into Plexo and rebuild the preview. Owners see it as "a copy of your app's code in your
// own GitHub account that stays in step both ways", so the page avoids git words wherever it can.

type Status = {
  configured: boolean;
  link: { repo: string; branch: string; status: "OK" | "CONFLICT" | "ERROR"; statusMessage: string | null; conflictPullRequestUrl: string | null; lastSyncedCommitSha: string | null; lastSyncedAt: string | null } | null;
  installations?: Array<{ id: number; account: string; type: string | null }>;
  installUrl?: string;
  repos?: Array<{ id: number; fullName: string; defaultBranch: string; private: boolean; empty: boolean }>;
};

// Plexo purples for decoration; green / amber / red only ever mean a status.
const P = { brand: BRAND.primary, deep: BRAND.deep, deeper: BRAND[700], lavender: BRAND[400], pale: "#c4b5fd", orchid: BRAND[300], indigo: "#6366f1" };

const GITHUB_CSS = `
@keyframes gh-flow { from { background-position: 0 0; } to { background-position: 28px 0; } }
.gh-flow { background-image: linear-gradient(90deg, ${P.lavender} 0 8px, transparent 8px 14px); background-size: 14px 2px; background-repeat: repeat-x; background-position: 0 0; animation: gh-flow 1.2s linear infinite; }
.gh-flow.is-back { animation-direction: reverse; }
@keyframes gh-spin { to { transform: rotate(360deg); } }
.gh-spin { animation: gh-spin 0.9s linear infinite; }
.gh-choice { transition: border-color 0.15s, background 0.15s; }
.gh-choice:hover { border-color: rgba(var(--brand-rgb), 0.45) !important; }
.gh-choice:focus-within { outline: 2px solid ${P.brand}; outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { .gh-flow, .gh-spin { animation: none; } }
`;

/** The GitHub mark (lucide in this version has no brand icons). */
function GitHubMark({ size = 16, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden style={{ flexShrink: 0 }}>
      <path d="M12 .5C5.65.5.5 5.65.5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.37-3.87-1.37-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.76 2.69 1.25 3.35.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.18-3.08-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.58.23 2.75.11 3.04.74.8 1.18 1.82 1.18 3.08 0 4.41-2.69 5.38-5.25 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}

/** Your Plexo app on the left, its code on GitHub on the right, changes flowing both ways. */
function SyncIllustration() {
  const card: CSSProperties = { flex: "1 1 0", minWidth: 0, borderRadius: 14, border: `1px solid ${C.borderStrong}`, padding: 12, display: "flex", flexDirection: "column", gap: 8, boxShadow: "0 24px 60px rgba(0,0,0,0.35)" };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      {/* The app: a tiny browser window with a hero, a button and a couple of tiles. */}
      <div style={{ ...card, background: "rgba(11,15,25,0.6)", transform: "rotate(-2deg)" }}>
        <div style={{ display: "flex", gap: 4, paddingBottom: 6, borderBottom: `1px solid ${C.border}` }}>
          {[P.pale, P.lavender, P.brand].map((c) => (
            <span key={c} style={{ width: 7, height: 7, borderRadius: 99, background: c, opacity: 0.8 }} />
          ))}
        </div>
        <span style={{ height: 34, borderRadius: 8, background: `linear-gradient(135deg, ${P.brand}, ${P.indigo})` }} />
        <span style={{ width: "70%", height: 6, borderRadius: 99, background: "rgba(255,255,255,0.3)" }} />
        <span style={{ width: "48%", height: 6, borderRadius: 99, background: "rgba(255,255,255,0.14)" }} />
        <div style={{ display: "flex", gap: 6 }}>
          <span style={{ flex: 1, height: 22, borderRadius: 6, background: `${P.orchid}55` }} />
          <span style={{ flex: 1, height: 22, borderRadius: 6, background: `${P.lavender}40` }} />
        </div>
        <span style={{ fontSize: "0.66rem", fontWeight: 650, color: C.muted, marginTop: 2 }}>Your app</span>
      </div>

      {/* Two lanes of moving dashes: changes going out, and coming back. */}
      <div style={{ width: 70, flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
        <span className="gh-flow" style={{ width: "100%", height: 2 }} />
        <span style={{ width: 36, height: 36, borderRadius: 99, display: "grid", placeItems: "center", background: `linear-gradient(135deg, ${P.brand}, ${P.deeper})`, color: "#fff", boxShadow: `0 0 0 6px ${P.brand}22` }}>
          <ArrowLeftRight size={16} />
        </span>
        <span className="gh-flow is-back" style={{ width: "100%", height: 2 }} />
      </div>

      {/* The code on GitHub: a dark editor card with coloured lines. */}
      <div style={{ ...card, background: "#0d1117", transform: "rotate(2deg)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, paddingBottom: 6, borderBottom: `1px solid ${C.border}` }}>
          <GitHubMark size={14} color={C.text} />
          <span style={{ width: "50%", height: 6, borderRadius: 99, background: "rgba(255,255,255,0.3)" }} />
        </div>
        {[
          { indent: 0, w: "62%", c: P.orchid },
          { indent: 10, w: "54%", c: P.lavender },
          { indent: 10, w: "40%", c: P.indigo },
          { indent: 20, w: "46%", c: P.pale },
          { indent: 0, w: "30%", c: P.brand },
        ].map((l, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: l.indent }}>
            <span style={{ width: 10, height: 5, borderRadius: 99, background: l.c }} />
            <span style={{ width: l.w, height: 5, borderRadius: 99, background: "rgba(255,255,255,0.16)" }} />
          </div>
        ))}
        <span style={{ fontSize: "0.66rem", fontWeight: 650, color: C.muted, marginTop: 2 }}>Its code on GitHub</span>
      </div>
    </div>
  );
}

/** First load: the shape of the connected card, gently shimmering. */
function GitHubSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading GitHub" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "1.5rem", borderRadius: 20, border: `1px solid ${C.border}` }}>
        <Shimmer width={56} height={56} radius={16} />
        <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 9 }}>
          <Shimmer width="38%" height={14} radius={99} />
          <Shimmer width="24%" height={9} radius={99} />
        </span>
        <Shimmer width={96} height={32} radius={9} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 14, padding: "1rem 1.1rem", borderRadius: 16, border: `1px solid ${C.border}` }}>
            <Shimmer width={40} height={40} radius={12} />
            <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 7 }}>
              <Shimmer width="50%" height={12} radius={99} />
              <Shimmer width="70%" height={8} radius={99} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const fieldLabel: CSSProperties = { display: "flex", flexDirection: "column", gap: 6, fontSize: "0.78rem", fontWeight: 600, color: C.text };
const fieldHint: CSSProperties = { fontSize: "0.72rem", fontWeight: 400, color: C.muted, lineHeight: 1.45 };

export function GitHubPane(props: { appId: string; onLinked?: (buildId: string | null) => void }) {
  const { appId } = props;
  const [status, setStatus] = useState<Status | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [installationId, setInstallationId] = useState<number | null>(null);
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("main");
  const [prefer, setPrefer] = useState<"github" | "plexo">("github");
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "danger" | "info"; text: string } | null>(null);
  const hasStatus = useRef(false);

  const load = useCallback(
    async (inst: number | null = installationId) => {
      try {
        const res = await api<Status>(`/api/v1/apps/${appId}/github${inst ? `?installationId=${inst}` : ""}`);
        setStatus(res);
        hasStatus.current = true;
        setLoadError(null);
        if (!inst && res.installations?.length === 1) {
          setInstallationId(res.installations[0].id);
          void load(res.installations[0].id);
        }
      } catch (err) {
        const text = err instanceof ApiError ? err.message : "Couldn't load GitHub.";
        // Nothing on screen yet → the full problem state; otherwise a notice above what's there.
        if (hasStatus.current) setMessage({ tone: "danger", text });
        else setLoadError(text);
      }
    },
    [appId, installationId],
  );

  useEffect(() => {
    void load(null);
    const result = new URLSearchParams(window.location.search).get("github");
    if (result === "connected") setMessage({ tone: "success", text: "GitHub is connected. Pick a project to keep in step with this app." });
    else if (result === "denied") setMessage({ tone: "danger", text: "Your GitHub account doesn't have access to that installation." });
    else if (result === "requested") setMessage({ tone: "info", text: "GitHub sent your request to the organization's owners. Once they approve, come back here." });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedRepo = status?.repos?.find((r) => r.fullName === repo);

  async function link() {
    if (!installationId || !repo) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await api<{ action: "pushed" | "imported"; buildId: string | null }>(`/api/v1/apps/${appId}/github`, { method: "POST", json: { installationId, repo, branch, prefer } });
      setMessage({ tone: "success", text: res.action === "imported" ? `Brought ${repo} into this app — rebuilding the preview.` : `Copied this app to ${repo}. From now on every change syncs both ways.` });
      props.onLinked?.(res.buildId);
      await load();
    } catch (err) {
      setMessage({ tone: "danger", text: err instanceof ApiError ? err.message : "Couldn't connect to that project." });
    } finally {
      setBusy(false);
    }
  }

  async function syncNow() {
    setBusy(true);
    setSyncing(true);
    await api(`/api/v1/apps/${appId}/github`, { method: "PATCH", json: { action: "sync" } }).catch(() => undefined);
    await load();
    setSyncing(false);
    setBusy(false);
  }

  async function disconnect() {
    if (!window.confirm("Stop syncing with GitHub? The project on GitHub itself isn't changed.")) return;
    await api(`/api/v1/apps/${appId}/github`, { method: "DELETE" }).catch(() => undefined);
    await load();
  }

  const header = (
    <PaneHeader
      title="GitHub"
      subtitle="Keep a copy of your app's code in your own GitHub account, kept in step both ways."
      actions={
        status?.link ? (
          <Button size="sm" variant="ghost" onClick={() => void load()} disabled={busy} aria-label="Check again">
            <RefreshCw size={13} /> Check again
          </Button>
        ) : undefined
      }
    />
  );

  let body;
  if (!status && loadError) {
    body = (
      <ProblemState
        title="We couldn't reach GitHub just now"
        message={`${loadError} Your app and its code are safe — nothing has changed.`}
        onRetry={() => {
          setLoadError(null);
          void load(installationId);
        }}
      />
    );
  } else if (!status) {
    body = <GitHubSkeleton />;
  } else if (!status.configured) {
    body = (
      <EmptyHero
        tint={P.indigo}
        title="GitHub sync isn't switched on yet"
        body="Connecting apps to GitHub hasn't been set up on this Plexo environment, so there's nothing to do here for now. Your app works exactly the same without it."
        art={<SyncIllustration />}
      />
    );
  } else if (status.link) {
    body = renderConnected();
  } else {
    body = renderNotConnected();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, color: C.text, minWidth: 0 }}>
      <style>{GITHUB_CSS}</style>
      <StateStyles />
      {header}
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {body}
    </div>
  );

  // ---------------------------------------------------------------- not connected

  function renderNotConnected() {
    const s = status!;
    const hasAccess = !!s.installations?.length;
    return (
      <EmptyHero
        tint={P.brand}
        title={hasAccess ? "Pick a project on GitHub" : "Connect your app to GitHub"}
        body={
          <>
            Keep a copy of your app&rsquo;s code in your own GitHub account. Changes you or SOL make here show up there, and changes made there come back here.
          </>
        }
        art={<SyncIllustration />}
      >
        {!hasAccess ? (
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <a href={s.installUrl} style={{ textDecoration: "none" }}>
              <Button variant="primary">
                <GitHubMark size={15} /> Connect GitHub
              </Button>
            </a>
            <span style={{ fontSize: "0.76rem", color: C.faint }}>You&rsquo;ll choose which projects Plexo can see on GitHub, then come straight back.</span>
          </div>
        ) : (
          renderLinkForm()
        )}
      </EmptyHero>
    );
  }

  function renderLinkForm() {
    const s = status!;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "1.1rem 1.2rem", borderRadius: 16, border: `1px solid ${C.border}`, background: "rgba(11,15,25,0.45)" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
          <label style={fieldLabel}>
            GitHub account
            <select
              value={installationId ?? ""}
              onChange={(e) => {
                const v = Number(e.target.value) || null;
                setInstallationId(v);
                setRepo("");
                void load(v);
              }}
              style={inputStyle}
            >
              <option value="">Choose…</option>
              {s.installations!.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.account}
                </option>
              ))}
            </select>
          </label>
          {s.repos && (
            <label style={fieldLabel}>
              Project
              <select
                value={repo}
                onChange={(e) => {
                  setRepo(e.target.value);
                  setBranch(s.repos!.find((r) => r.fullName === e.target.value)?.defaultBranch ?? "main");
                }}
                style={inputStyle}
              >
                <option value="">Choose…</option>
                {s.repos.map((r) => (
                  <option key={r.id} value={r.fullName}>
                    {r.fullName}
                    {r.private ? " (private)" : ""}
                    {r.empty ? " — empty" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {repo && (
          <>
            <label style={fieldLabel}>
              <span>
                Branch <span style={fieldHint}>— the version of the project to keep in step. Most people leave this as it is.</span>
              </span>
              <input value={branch} onChange={(e) => setBranch(e.target.value)} style={{ ...inputStyle, fontFamily: C.mono, maxWidth: 320 }} />
            </label>

            {selectedRepo && !selectedRepo.empty && (
              <fieldset style={{ border: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                <legend style={{ fontSize: "0.78rem", fontWeight: 600, marginBottom: 8, padding: 0 }}>This project already has code. Which copy should win?</legend>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
                  <ChoiceCard
                    checked={prefer === "github"}
                    onPick={() => setPrefer("github")}
                    icon={<Download size={16} />}
                    title="Bring its code into this app"
                    body="Replaces this app's files with the ones on GitHub."
                  />
                  <ChoiceCard
                    checked={prefer === "plexo"}
                    onPick={() => setPrefer("plexo")}
                    icon={<Upload size={16} />}
                    title="Send this app's code to it"
                    body="Adds this app's files to GitHub as a new saved change."
                  />
                </div>
              </fieldset>
            )}

            <div>
              <Button variant="primary" disabled={busy || !branch.trim()} onClick={() => void link()}>
                <ArrowLeftRight size={14} /> {busy ? "Connecting…" : "Connect this project"}
              </Button>
            </div>
          </>
        )}

        <a href={s.installUrl} style={{ fontSize: "0.76rem", color: P.pale, display: "inline-flex", alignItems: "center", gap: 4 }}>
          Don&rsquo;t see your project? Give Plexo access on GitHub <ArrowUpRight size={12} />
        </a>
      </div>
    );
  }

  // ---------------------------------------------------------------- connected

  function renderConnected() {
    const l = status!.link!;
    const projectUrl = `https://github.com/${l.repo}/tree/${encodeURIComponent(l.branch)}`;
    const [owner, name] = l.repo.includes("/") ? l.repo.split("/") : ["", l.repo];
    const state = syncing
      ? { color: P.lavender, label: "Syncing…", word: "Syncing" }
      : l.status === "OK"
        ? { color: C.success, label: "In sync", word: "In sync" }
        : l.status === "CONFLICT"
          ? { color: C.warning, label: "Needs your attention", word: "Needs a look" }
          : { color: C.danger, label: "Sync stopped", word: "Stopped" };

    return (
      <>
        {/* The link itself: which project, how it's doing, and what you can do. */}
        <section
          style={{
            display: "flex",
            alignItems: "center",
            gap: "1.1rem 1.4rem",
            flexWrap: "wrap",
            padding: "1.5rem 1.6rem",
            borderRadius: 20,
            border: `1px solid ${C.border}`,
            background: `radial-gradient(70% 120% at 100% 0%, ${P.brand}26, transparent 60%), radial-gradient(60% 100% at 0% 100%, ${P.indigo}14, transparent 60%), rgba(255,255,255,0.015)`,
          }}
        >
          <span style={{ width: 56, height: 56, borderRadius: 16, display: "grid", placeItems: "center", background: `linear-gradient(135deg, ${P.brand}, ${P.deeper})`, color: "#fff", flexShrink: 0, boxShadow: `0 12px 30px ${P.brand}40` }}>
            <GitHubMark size={26} />
          </span>
          <div style={{ flex: "1 1 280px", minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <a href={projectUrl} target="_blank" rel="noopener" style={{ color: C.text, textDecoration: "none", fontSize: "1.2rem", fontWeight: 750, letterSpacing: "-0.01em", display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                {owner && <span style={{ color: C.muted, fontWeight: 500 }}>{owner} /</span>}
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
                <ExternalLink size={14} color={C.muted} />
              </a>
              <Pill color={state.color}>{state.label}</Pill>
            </div>
            <p style={{ margin: "0.35rem 0 0", fontSize: "0.82rem", color: C.muted, lineHeight: 1.55 }}>
              Every change you or SOL make is saved there too, and changes made on GitHub come back here and refresh your preview.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button variant="primary" disabled={busy} onClick={() => void syncNow()}>
              <RefreshCw size={14} className={syncing ? "gh-spin" : undefined} /> {syncing ? "Syncing…" : "Sync now"}
            </Button>
            <a href={projectUrl} target="_blank" rel="noopener" style={{ textDecoration: "none" }}>
              <Button>
                <GitHubMark size={14} /> Open on GitHub
              </Button>
            </a>
            <Button variant="danger" disabled={busy} onClick={() => void disconnect()}>
              <Link2Off size={14} /> Disconnect
            </Button>
          </div>
        </section>

        {l.status === "CONFLICT" && (
          <Notice tone="warning">
            {l.statusMessage} — Plexo didn&rsquo;t overwrite anything; its changes are waiting for you on GitHub.{" "}
            {l.conflictPullRequestUrl && (
              <a href={l.conflictPullRequestUrl} target="_blank" rel="noopener" style={{ color: C.warning, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 3 }}>
                Review them on GitHub <ExternalLink size={12} />
              </a>
            )}{" "}
            Accept them there (press &ldquo;Merge&rdquo;), then press &ldquo;Sync now&rdquo;.
          </Notice>
        )}
        {l.status === "ERROR" && <Notice tone="danger">{l.statusMessage}</Notice>}

        {/* At a glance. */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
          <StatCard label="Status" value={state.word} color={state.color} icon={ArrowLeftRight} />
          <StatCard label="Kept in step with" value={<span style={{ fontFamily: C.mono, fontSize: "1.05rem" }}>{l.branch}</span>} color={P.indigo} icon={GitBranch} />
          {/* Links made before sync times were recorded show one after their next sync. */}
          <StatCard label="Last synced" value={l.lastSyncedAt ? timeAgo(l.lastSyncedAt) : "After the next sync"} color={P.orchid} icon={Clock} />
        </div>

        {/* How it works, in three plain steps. */}
        <section style={{ border: `1px solid ${C.border}`, borderRadius: 18, background: C.panel, overflow: "hidden" }}>
          <div style={{ padding: "0.9rem 1.1rem", borderBottom: `1px solid ${C.border}`, fontSize: "0.9rem", fontWeight: 700 }}>How syncing works</div>
          {[
            { icon: Upload, color: P.brand, title: "You or SOL change something here", body: "A copy of the change is saved to your GitHub project automatically." },
            { icon: Download, color: P.indigo, title: "Someone changes the code on GitHub", body: "It comes back into Plexo and your preview rebuilds on its own." },
            { icon: ArrowLeftRight, color: P.orchid, title: "Both sides changed at once", body: "Plexo never overwrites anything — it leaves its changes on GitHub for you to accept, then you press Sync now." },
          ].map(({ icon: Icon, color, title, body }, i, all) => (
            <div key={title} className="plx-row" style={{ display: "flex", alignItems: "center", gap: 14, padding: "0.9rem 1.1rem", borderBottom: i < all.length - 1 ? `1px solid ${C.border}` : "none" }}>
              <span style={{ width: 36, height: 36, borderRadius: 11, display: "grid", placeItems: "center", background: `${color}26`, color, flexShrink: 0 }}>
                <Icon size={17} />
              </span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontSize: "0.86rem", fontWeight: 650 }}>{title}</span>
                <span style={{ display: "block", fontSize: "0.78rem", color: C.muted, marginTop: 2, lineHeight: 1.5 }}>{body}</span>
              </span>
            </div>
          ))}
        </section>
      </>
    );
  }
}

/** One of two big, tappable options (a styled radio). */
function ChoiceCard({ checked, onPick, icon, title, body }: { checked: boolean; onPick: () => void; icon: ReactNode; title: string; body: string }) {
  return (
    <label
      className="gh-choice"
      style={{
        position: "relative",
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        padding: "0.85rem 0.95rem",
        borderRadius: 14,
        cursor: "pointer",
        border: `1px solid ${checked ? `${P.brand}99` : C.border}`,
        background: checked ? `${P.brand}1a` : "rgba(255,255,255,0.03)",
      }}
    >
      <input type="radio" checked={checked} onChange={onPick} style={{ position: "absolute", opacity: 0, pointerEvents: "none" }} />
      <span style={{ width: 32, height: 32, borderRadius: 10, display: "grid", placeItems: "center", background: checked ? P.brand : `${P.brand}26`, color: checked ? "#fff" : P.pale, flexShrink: 0 }}>{icon}</span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontSize: "0.84rem", fontWeight: 650 }}>{title}</span>
        <span style={{ display: "block", fontSize: "0.74rem", color: C.muted, marginTop: 2, lineHeight: 1.45 }}>{body}</span>
      </span>
    </label>
  );
}
