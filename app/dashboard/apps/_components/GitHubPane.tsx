"use client";

import { useCallback, useEffect, useState } from "react";
import { GitBranch, ExternalLink } from "lucide-react";
import { api, ApiError } from "./api";
import { C, Button, Panel, Notice, Empty, inputStyle } from "./ui";

// Two-way GitHub sync: every Plexo version becomes a commit, and pushes to the branch come
// back into Plexo and rebuild the preview.

type Status = {
  configured: boolean;
  link: { repo: string; branch: string; status: "OK" | "CONFLICT" | "ERROR"; statusMessage: string | null; conflictPullRequestUrl: string | null; lastSyncedCommitSha: string | null } | null;
  installations?: Array<{ id: number; account: string; type: string | null }>;
  installUrl?: string;
  repos?: Array<{ id: number; fullName: string; defaultBranch: string; private: boolean; empty: boolean }>;
};

export function GitHubPane(props: { appId: string; onLinked?: (buildId: string | null) => void }) {
  const { appId } = props;
  const [status, setStatus] = useState<Status | null>(null);
  const [installationId, setInstallationId] = useState<number | null>(null);
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("main");
  const [prefer, setPrefer] = useState<"github" | "plexo">("github");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "danger" | "info"; text: string } | null>(null);

  const load = useCallback(
    async (inst: number | null = installationId) => {
      try {
        const res = await api<Status>(`/api/v1/apps/${appId}/github${inst ? `?installationId=${inst}` : ""}`);
        setStatus(res);
        if (!inst && res.installations?.length === 1) {
          setInstallationId(res.installations[0].id);
          void load(res.installations[0].id);
        }
      } catch (err) {
        setMessage({ tone: "danger", text: err instanceof ApiError ? err.message : "Couldn't load GitHub." });
      }
    },
    [appId, installationId],
  );

  useEffect(() => {
    void load(null);
    const result = new URLSearchParams(window.location.search).get("github");
    if (result === "connected") setMessage({ tone: "success", text: "GitHub is connected. Pick a repository to sync with." });
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
      setMessage({ tone: "success", text: res.action === "imported" ? `Imported ${repo} into this app — rebuilding the preview.` : `Pushed this app to ${repo}. From now on every change syncs both ways.` });
      props.onLinked?.(res.buildId);
      await load();
    } catch (err) {
      setMessage({ tone: "danger", text: err instanceof ApiError ? err.message : "Couldn't link the repository." });
    } finally {
      setBusy(false);
    }
  }

  if (!status) return <Empty title="Loading GitHub…" />;
  if (!status.configured) return <Empty title="GitHub sync isn't available yet">It hasn't been set up on this Plexo environment.</Empty>;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 440px), 1fr))", alignItems: "start", gap: 12 }}>
      {message && <div style={{ gridColumn: "1 / -1" }}><Notice tone={message.tone}>{message.text}</Notice></div>}
      {status.link ? (
        <Panel title="Synced with GitHub" description="Every change you or SOL make is committed here, and pushes to this branch come back into Plexo.">
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <GitBranch size={16} color={C.brand} />
            <a href={`https://github.com/${status.link.repo}/tree/${encodeURIComponent(status.link.branch)}`} target="_blank" rel="noopener" style={{ color: C.text, fontFamily: C.mono, fontSize: "0.82rem" }}>
              {status.link.repo} · {status.link.branch}
            </a>
            {status.link.lastSyncedCommitSha && <span style={{ fontSize: "0.74rem", color: C.faint, fontFamily: C.mono }}>{status.link.lastSyncedCommitSha.slice(0, 7)}</span>}
          </div>
          {status.link.status === "CONFLICT" && (
            <div style={{ marginTop: 10 }}>
              <Notice tone="warning">
                {status.link.statusMessage} — Plexo didn't overwrite anything; its changes are in a pull request.{" "}
                {status.link.conflictPullRequestUrl && (
                  <a href={status.link.conflictPullRequestUrl} target="_blank" rel="noopener" style={{ color: C.warning }}>
                    Open the pull request <ExternalLink size={12} />
                  </a>
                )}{" "}
                Merge it on GitHub, then press “Sync now”.
              </Notice>
            </div>
          )}
          {status.link.status === "ERROR" && (
            <div style={{ marginTop: 10 }}>
              <Notice tone="danger">{status.link.statusMessage}</Notice>
            </div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <Button
              size="sm"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await api(`/api/v1/apps/${appId}/github`, { method: "PATCH", json: { action: "sync" } }).catch(() => undefined);
                await load();
                setBusy(false);
              }}
            >
              Sync now
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={busy}
              onClick={async () => {
                if (!window.confirm("Stop syncing with GitHub? The repository itself isn't changed.")) return;
                await api(`/api/v1/apps/${appId}/github`, { method: "DELETE" }).catch(() => undefined);
                await load();
              }}
            >
              Unlink
            </Button>
          </div>
        </Panel>
      ) : (
        <Panel title="Connect a GitHub repository" description="Keep your app's code in your own GitHub repo. Changes sync both ways: edit in Plexo, or push from your computer — the preview updates either way.">
          {!status.installations?.length ? (
            <a href={status.installUrl} style={{ textDecoration: "none" }}>
              <Button variant="primary">
                <GitBranch size={14} /> Connect GitHub
              </Button>
            </a>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <label style={{ fontSize: "0.74rem", color: C.muted }}>
                Account
                <select
                  value={installationId ?? ""}
                  onChange={(e) => {
                    const v = Number(e.target.value) || null;
                    setInstallationId(v);
                    setRepo("");
                    void load(v);
                  }}
                  style={{ ...inputStyle, marginTop: 4 }}
                >
                  <option value="">Choose…</option>
                  {status.installations.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.account}
                    </option>
                  ))}
                </select>
              </label>
              {status.repos && (
                <label style={{ fontSize: "0.74rem", color: C.muted }}>
                  Repository
                  <select
                    value={repo}
                    onChange={(e) => {
                      setRepo(e.target.value);
                      setBranch(status.repos!.find((r) => r.fullName === e.target.value)?.defaultBranch ?? "main");
                    }}
                    style={{ ...inputStyle, marginTop: 4 }}
                  >
                    <option value="">Choose…</option>
                    {status.repos.map((r) => (
                      <option key={r.id} value={r.fullName}>
                        {r.fullName}
                        {r.private ? " (private)" : ""}
                        {r.empty ? " — empty" : ""}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {repo && (
                <>
                  <label style={{ fontSize: "0.74rem", color: C.muted }}>
                    Branch
                    <input value={branch} onChange={(e) => setBranch(e.target.value)} style={{ ...inputStyle, marginTop: 4, fontFamily: C.mono }} />
                  </label>
                  {selectedRepo && !selectedRepo.empty && (
                    <fieldset style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "0.6rem 0.75rem", display: "flex", flexDirection: "column", gap: 6, fontSize: "0.78rem" }}>
                      <legend style={{ fontSize: "0.72rem", color: C.muted }}>This repository already has code</legend>
                      <label>
                        <input type="radio" checked={prefer === "github"} onChange={() => setPrefer("github")} /> Bring its code into this app (replaces the app's files)
                      </label>
                      <label>
                        <input type="radio" checked={prefer === "plexo"} onChange={() => setPrefer("plexo")} /> Push this app's code to it (as a new commit)
                      </label>
                    </fieldset>
                  )}
                  <div>
                    <Button variant="primary" disabled={busy || !branch.trim()} onClick={() => void link()}>
                      {busy ? "Linking…" : "Link repository"}
                    </Button>
                  </div>
                </>
              )}
              <a href={status.installUrl} style={{ fontSize: "0.74rem", color: C.muted }}>
                Don't see your repository? Give Plexo access on GitHub
              </a>
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}
