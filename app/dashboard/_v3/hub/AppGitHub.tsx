"use client";

import { useCallback, useEffect, useState } from "react";
import { GitBranch } from "lucide-react";
import { Button, ButtonLink, Card, CardHeader, Input, Select, Skeleton, useToast } from "../ui";
import { errMsg, hubApi } from "./hubApi";

type Repo = { fullName: string; defaultBranch: string; empty: boolean };
type Status = { configured: boolean; lockedRepo?: string | null; link: { installationId: number; repo: string; branch: string; status: string } | null; installations: { id: number; account: string }[]; installUrl: string | null; repos?: Repo[] };
export type GitState = { linked: boolean; repo?: string; branch?: string; status?: "OK" | "ERROR"; statusMessage?: string; publishOnPush?: boolean; activeBuildId: string | null };

/** The app's GitHub connection: connect a repository, switch branch, or disconnect. Same server routes as the old page, in plain words. */
export function AppGitHub({ siteId, git, onChanged, onBuildStarted }: { siteId: string; git: GitState | null; onChanged: () => void; onBuildStarted: (id: string) => void }) {
  const { show } = useToast();
  const base = `/api/v1/templates/${siteId}/ssr-github`;
  const returnTo = `/dashboard/sites/${siteId}?tab=app`;
  const [status, setStatus] = useState<Status | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [installation, setInstallation] = useState<number | null>(null);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (inst?: number | null) => {
    try {
      const r = await hubApi<Status>(`${base}?${inst ? `installationId=${inst}&` : ""}returnTo=${encodeURIComponent(returnTo)}`, undefined, "GitHub couldn't be reached right now.");
      setLoadError(null);
      if (inst) {
        const list = (r.repos ?? []).filter((x) => !x.empty).filter((x) => !r.lockedRepo || x.fullName.toLowerCase() === r.lockedRepo.toLowerCase());
        setRepos(list);
        if (list.length && !list.some((x) => x.fullName === repo)) { setRepo(list[0].fullName); setBranch(list[0].defaultBranch); }
      } else {
        setStatus(r);
        setInstallation(r.installations[0]?.id ?? null);
      }
    } catch (e) {
      setLoadError(errMsg(e));
    }
  }, [base, returnTo, repo]);
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  useEffect(() => { if (installation && !git?.linked) void load(installation); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [installation, git?.linked]);

  async function connect(inst: number, repoName: string, ref: string) {
    setBusy(true);
    setError(null);
    try {
      const r = await hubApi<{ buildId?: string; message?: string }>(`/api/v1/templates/${siteId}/ssr-deploy`, { method: "POST", json: { github: { installationId: inst, repo: repoName, ref } } }, "We couldn't connect that repository. Please try again.");
      show({ title: r.message ?? "Connected. Building your app now.", tone: "success" });
      if (r.buildId) onBuildStarted(r.buildId);
      onChanged();
      void load();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
  async function disconnect() {
    if (!window.confirm(`Disconnect ${git?.repo ?? "GitHub"}? New changes there will stop updating your app. The app itself stays online.`)) return;
    setBusy(true);
    try {
      await hubApi(base, { method: "DELETE" }, "We couldn't disconnect. Please try again.");
      show({ title: "Disconnected from GitHub", tone: "success" });
      onChanged();
      void load();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  if (loadError) return <Card><CardHeader title="GitHub" /><p className="plx-field__error" role="alert">{loadError}</p></Card>;
  if (!status) return <Card><Skeleton height={20} width="30%" style={{ marginBottom: 12 }} /><Skeleton height={48} /></Card>;
  if (!status.configured) return null;
  const linked = git?.linked ? git : null;
  const hasAccount = status.installations.length > 0;

  return (
    <Card data-tour="hub-app-github">
      <CardHeader title="GitHub" description="Keep your app's code on GitHub. Each change you save there updates your app by itself." />
      {linked ? (
        <div className="plx-form">
          <div className="plx-inlinemsg"><GitBranch size={18} aria-hidden style={{ flex: "none", marginTop: 2 }} /><span>Connected to <b>{linked.repo}</b> on <b>{linked.branch}</b>. {linked.publishOnPush ? "Every change there goes online on its own." : "Every change there is built, and you put it online."}</span></div>
          {linked.status === "ERROR" && linked.statusMessage ? <div className="plx-inlinemsg plx-inlinemsg--bad" role="alert">{linked.statusMessage}</div> : null}
          <div className="plx-hactionrow" style={{ borderTop: 0, paddingTop: 0, marginTop: 0 }}>
            <ButtonLink href={`https://github.com/${linked.repo}`} target="_blank" rel="noreferrer" variant="secondary">Open code on GitHub</ButtonLink>
            <Button variant="ghost" loading={busy} onClick={disconnect}>Disconnect</Button>
          </div>
          <details className="plx-more"><summary>Build from a different branch</summary>
            <div className="plx-form" style={{ marginTop: 12 }}>
              <Input label="Branch" value={branch} onChange={(e) => setBranch(e.target.value)} placeholder={linked.branch} />
              <div><Button variant="secondary" disabled={!branch.trim() || busy} onClick={() => window.confirm(`Build from ${branch.trim()}? Your app's files are replaced with that branch's files.`) && status.link && connect(status.link.installationId, status.link.repo, branch.trim())}>Use this branch</Button></div>
            </div>
          </details>
        </div>
      ) : !hasAccount ? (
        <div className="plx-form">
          <p className="plx-body">Connect your GitHub account to build your app from its code.</p>
          {status.installUrl ? <div><ButtonLink href={status.installUrl} leftIcon={<GitBranch size={18} aria-hidden />}>Connect GitHub</ButtonLink></div> : null}
        </div>
      ) : (
        <div className="plx-form">
          {status.installations.length > 1 ? <Select label="GitHub account" value={String(installation ?? "")} onChange={(e) => { setRepos([]); setRepo(""); setInstallation(Number(e.target.value)); }} options={status.installations.map((i) => ({ value: String(i.id), label: i.account }))} /> : null}
          {repos.length ? (
            <div className="plx-form__two">
              <Select label="Which project?" value={repo} onChange={(e) => { setRepo(e.target.value); setBranch(repos.find((r) => r.fullName === e.target.value)?.defaultBranch ?? ""); }} options={repos.map((r) => ({ value: r.fullName, label: r.fullName }))} />
              <Input label="Branch" value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" />
            </div>
          ) : <p className="plx-small">No projects are shared with Plexo on this GitHub account yet. Share one on GitHub, then come back here.</p>}
          {error ? <p className="plx-field__error" role="alert">{error}</p> : null}
          <p className="plx-small">Connecting replaces your app&apos;s files with that project&apos;s files, then builds it.</p>
          <div><Button loading={busy} disabled={!repo || !branch.trim() || installation === null} onClick={() => installation !== null && connect(installation, repo, branch.trim())}>Connect and build</Button></div>
        </div>
      )}
      {linked && error ? <p className="plx-field__error" role="alert">{error}</p> : null}
    </Card>
  );
}
