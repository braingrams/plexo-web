"use client";

import { useEffect, useState, type CSSProperties } from "react";

// The GitHub connection controls on a server app's detail page: connect a repository and branch, change the
// branch, or disconnect. Connecting or changing the branch copies that branch's files into the app, so both
// need the owner to confirm. Colours come from the theme variables (lib/theme.ts).
export function SsrGitHubConnection({ templateId }: { templateId: string }) {
  const [status, setStatus] = useState<GitHubStatus | null>(null);
  const [installationId, setInstallationId] = useState<number | null>(null);
  const [repos, setRepos] = useState<RepoOption[]>([]);
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const base = `/api/v1/apps/${templateId}/github`;
  const returnTo = `/dashboard/templates/${templateId}/detail`;

  async function load() {
    const res = await fetch(`${base}?returnTo=${encodeURIComponent(returnTo)}`);
    if (res.ok) setStatus(await res.json());
  }
  useEffect(() => {
    void load();
    // load reads the template id only; it is stable for this page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId]);

  // Pick the first connected account by default; load its repositories when it changes.
  useEffect(() => {
    if (!status) return;
    const first = installationId ?? status.installations[0]?.id ?? null;
    if (first !== installationId) setInstallationId(first);
    if (first === null) return;
    fetch(`${base}?installationId=${first}&returnTo=${encodeURIComponent(returnTo)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: GitHubStatus | null) => {
        const list = (data?.repos ?? []).filter((r) => !r.empty);
        setRepos(list);
        if (list.length && !list.some((r) => r.fullName === repo)) {
          setRepo(list[0].fullName);
          setBranch(list[0].defaultBranch);
        }
      })
      .catch(() => setRepos([]));
    // Only when the account list or the chosen account changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, installationId]);

  async function send(method: "POST" | "DELETE", body?: object) {
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await fetch(base, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? `That didn't work (server responded ${res.status}).`);
    setNotice(method === "DELETE" ? "Disconnected. Pushes to the repository no longer build this app." : "Connected. The repository's files are now the app's files.");
    await load();
  }

  if (!status || !status.configured) return null;

  const link = status.link;
  const hasAccount = status.installations.length > 0;

  return (
    <div style={{ borderTop: "1px solid var(--surface-border)", paddingTop: 14, marginTop: 14, display: "grid", gap: 10 }}>
      <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>GitHub</p>

      {link ? (
        <>
          <p style={hint}>
            Connected to <strong>{link.repo}</strong>. Change the branch to build from another one, or disconnect.
          </p>
          <div style={row}>
            <input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder={link.branch} style={input} aria-label="Branch" />
            <button
              type="button"
              disabled={busy || !branch.trim() || !agreed}
              onClick={() => {
                if (!window.confirm(`Build from ${branch.trim()} on ${link.repo}? The app's files will be replaced with that branch's files.`)) return;
                void send("POST", { installationId: link.installationId, repo: link.repo, branch: branch.trim(), prefer: "github" });
              }}
              style={button(!busy && !!branch.trim() && agreed)}
            >
              Change branch
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (!window.confirm(`Disconnect ${link.repo}? Pushes will stop building this app. Its current files stay.`)) return;
                void send("DELETE");
              }}
              style={secondary(!busy)}
            >
              Disconnect
            </button>
          </div>
          <label style={consent}>
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
            Changing the branch replaces the app&apos;s files with that branch&apos;s files.
          </label>
        </>
      ) : !hasAccount ? (
        <>
          <p style={hint}>Connect a GitHub account to build this app from a repository, and rebuild it on every push.</p>
          {status.installUrl ? (
            <a href={status.installUrl} style={{ ...button(true), textDecoration: "none", justifySelf: "start" }}>
              Connect GitHub
            </a>
          ) : null}
        </>
      ) : (
        <>
          <p style={hint}>Pick a repository and branch. Connecting replaces the app&apos;s files with the repository&apos;s files, and each push to that branch rebuilds the app.</p>
          <div style={row}>
            <select value={repo} onChange={(e) => { setRepo(e.target.value); setBranch(repos.find((r) => r.fullName === e.target.value)?.defaultBranch ?? ""); }} style={input} aria-label="Repository">
              {repos.map((r) => (
                <option key={r.fullName} value={r.fullName}>{r.fullName}</option>
              ))}
            </select>
            <input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" style={input} aria-label="Branch" />
          </div>
          <label style={consent}>
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
            Connecting replaces the app&apos;s files with the repository&apos;s files on that branch.
          </label>
          <button
            type="button"
            disabled={busy || !repo || !branch.trim() || !agreed || installationId === null}
            onClick={() => void send("POST", { installationId, repo, branch: branch.trim(), prefer: "github" })}
            style={button(!busy && !!repo && !!branch.trim() && agreed && installationId !== null)}
            >
            {busy ? "Connecting…" : "Connect repository"}
          </button>
        </>
      )}

      {notice ? <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-muted)" }}>{notice}</p> : null}
      {error ? <p style={{ margin: 0, fontSize: 12.5, color: "#f87171" }}>{error}</p> : null}
    </div>
  );
}

type RepoOption = { fullName: string; defaultBranch: string; private: boolean; empty: boolean };

type GitHubStatus = {
  configured: boolean;
  link: { installationId: number; repo: string; branch: string; status: string } | null;
  installations: Array<{ id: number; account: string; type: string | null }>;
  installUrl: string | null;
  repos?: RepoOption[];
};

const hint: CSSProperties = { margin: 0, fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5 };
const row: CSSProperties = { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" };
const input: CSSProperties = {
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid var(--surface-border)",
  background: "var(--surface)",
  color: "var(--text-main)",
  fontSize: 13,
  minWidth: 200,
};
const consent: CSSProperties = { display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5, color: "var(--text-muted)" };

function button(enabled: boolean): CSSProperties {
  return {
    padding: "8px 14px",
    borderRadius: 9,
    border: "none",
    fontWeight: 650,
    fontSize: 13,
    cursor: enabled ? "pointer" : "not-allowed",
    background: enabled ? "var(--brand)" : "var(--surface)",
    color: enabled ? "#fff" : "var(--text-muted)",
  };
}

function secondary(enabled: boolean): CSSProperties {
  return {
    padding: "8px 14px",
    borderRadius: 9,
    border: "1px solid var(--surface-border)",
    fontWeight: 650,
    fontSize: 13,
    cursor: enabled ? "pointer" : "not-allowed",
    background: "transparent",
    color: "var(--text-main)",
  };
}
