"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Code2, FilePlus2, MessagesSquare, RefreshCw, Rocket, ScrollText, Upload } from "lucide-react";
import { Badge, Button, ButtonLink, Card, CardHeader, Modal, useToast } from "../ui";
import { uploadSsrZip, queueSsrBuild } from "@/lib/projects/clientSsrUpload";
import { useBuildLog } from "@/app/dashboard/templates/[id]/detail/useBuildLog";
import { alwaysOnView, appStatusView, type AlwaysOn } from "@/lib/dashboardV3/hubApp";
import { TabBar } from "./HubFrame";
import { AppGitHub, type GitState } from "./AppGitHub";
import { AppVariables } from "./AppVariables";
import { errMsg, hubApi } from "./hubApi";

export type AppInfo = { kind: "server" | "static"; isLive: boolean; framework: string | null };

const POLL_MS = 3000;

/** Hosted apps: whether it's running, how to update it, GitHub, always-on and its settings. Server apps only get the parts that work for them. */
export function AppTab({ siteId, siteName, info }: { siteId: string; siteName: string; info: AppInfo }) {
  const { show } = useToast();
  const server = info.kind === "server";
  const [git, setGit] = useState<GitState | null>(null);
  const [alwaysOn, setAlwaysOn] = useState<AlwaysOn | null>(null);
  const [turningOff, setTurningOff] = useState(false);
  const [buildId, setBuildId] = useState<string | null>(null);
  const live = useBuildLog(buildId);
  const [gateError, setGateError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [pageOpen, setPageOpen] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLPreElement>(null);
  const base = `/api/v1/templates/${siteId}`;

  const refreshGit = useCallback(() => hubApi<GitState>(`${base}/ssr-git`).then((d) => { setGit(d); setGateError(null); }, (e) => setGateError((e as { status?: number }).status === 403 ? errMsg(e) : null)), [base]);
  const refreshAlways = useCallback(() => hubApi<{ request: AlwaysOn["request"]; status?: AlwaysOn["status"]; error?: string | null }>(`${base}/ssr-always-on`).then((d) => { setAlwaysOn({ request: d.request, status: d.status ?? "OFF", error: d.error ?? null }); if (d.request !== "APPROVED") setTurningOff(false); }, () => undefined), [base]);
  useEffect(() => { if (server) { void refreshGit(); void refreshAlways(); } }, [server, refreshGit, refreshAlways]);
  useEffect(() => { if (!git?.linked) return; const t = setInterval(() => void refreshGit(), POLL_MS); return () => clearInterval(t); }, [git?.linked, refreshGit]);
  useEffect(() => { if (alwaysOn?.status !== "STARTING" && !turningOff) return; const t = setInterval(() => void refreshAlways(), 5000); return () => clearInterval(t); }, [alwaysOn?.status, turningOff, refreshAlways]);
  useEffect(() => { const r = git?.activeBuildId ?? null; if (r && r !== buildId) setBuildId(r); }, [git?.activeBuildId, buildId]);
  useEffect(() => { const el = logRef.current; if (el) el.scrollTop = el.scrollHeight; }, [live.lines.length, showLog]);

  const building = (buildId !== null && live.status === null) || git?.activeBuildId != null;
  const status = appStatusView({ kind: info.kind, isLive: info.isLive || live.status === "SUCCEEDED", building: building && live.status === null, buildFailed: live.status === "FAILED" ? live.summary ?? "" : undefined, gitError: git?.status === "ERROR" ? git.statusMessage ?? "" : null });

  async function upload() {
    if (!file) return setError("Choose your app's .zip file first.");
    if (!agreed) return setError("Please tick the box to confirm the rules.");
    setBusy("upload");
    setError(null);
    try {
      if (server) {
        const sent = await uploadSsrZip(siteId, file, (d, t) => setProgress(`Uploading ${d} of ${t}…`));
        if (!sent.ok) throw new Error(sent.error);
        setProgress("Starting the build…");
        const q = await queueSsrBuild(siteId, sent.data.uploadKey);
        if (!q.ok) throw new Error(q.error);
        setBuildId(q.data.buildId);
        show({ title: "Building your app", description: q.data.message, tone: "success" });
      } else {
        const form = new FormData();
        form.append("file", file);
        await hubApi(`${base}/deploy`, { method: "POST", body: form }, "We couldn't upload that. Check it's a .zip of your finished app.");
        show({ title: "Your app is updated", tone: "success" });
      }
      setUploadOpen(false);
      setFile(null);
      setAgreed(false);
      setShowLog(server);
    } catch (e) {
      setError(errMsg(e, "The upload didn't finish. Please try again."));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }
  async function rebuild() {
    setBusy("rebuild");
    try {
      const r = await hubApi<{ buildId: string; message: string }>(`${base}/ssr-rebuild`, { method: "POST" }, "We couldn't start a rebuild.");
      setBuildId(r.buildId);
      setShowLog(true);
      show({ title: "Rebuilding your app", description: r.message, tone: "success" });
    } catch (e) {
      show({ title: errMsg(e, "We couldn't start a rebuild. Upload your app again."), tone: "danger" });
    } finally {
      setBusy(null);
    }
  }
  async function always(action?: "turnOff") {
    if (action && !window.confirm("Turn off always on? Your app goes back to starting up when someone visits. You'd need to ask again to turn it back on.")) return;
    setBusy("always");
    try {
      await hubApi(`${base}/ssr-always-on`, { method: "POST", json: action ? { action } : undefined }, "That didn't work. Please try again.");
      if (action) setTurningOff(true);
      await refreshAlways();
    } catch (e) {
      show({ title: errMsg(e), tone: "danger" });
    } finally {
      setBusy(null);
    }
  }

  const ao = alwaysOnView(alwaysOn, turningOff);
  const solPage = `/dashboard/sol?new=1&draft=${encodeURIComponent(`Add a new page to my app "${siteName}". `)}`;

  return (
    <>
      <TabBar
        title="Your app"
        sub={server ? "Code you wrote, running on Plexo." : "Your app's files, online."}
        action={
          <div className="plx-hub__actions">
            <Button variant="secondary" leftIcon={<FilePlus2 size={18} aria-hidden />} onClick={() => setPageOpen(true)} data-tour="hub-add-page">Add a page</Button>
            <Button leftIcon={<Upload size={18} aria-hidden />} onClick={() => { setError(null); setUploadOpen(true); }} data-tour="hub-app-update">Upload a new version</Button>
          </div>
        }
      />
      <div className="plx-hub__split" data-tour="hub-app">
        <div className="plx-hub__col">
          <Card data-tour="hub-app-status">
            <div className="plx-appstatus">
              <span className={`plx-appstatus__dot plx-appstatus__dot--${status.state}`} aria-hidden />
              <div style={{ minWidth: 0 }}>
                <h2 className="plx-h3" style={{ margin: 0 }}>{status.title}</h2>
                <p className="plx-body" style={{ margin: "4px 0 0" }} role="status">{status.body}</p>
              </div>
              {info.framework && info.framework !== "spa" ? <Badge className="plx-appstatus__fw">{info.framework}</Badge> : null}
            </div>
            {gateError ? <div className="plx-inlinemsg plx-inlinemsg--warn" style={{ marginTop: 14 }}>{gateError}</div> : null}
            {server ? (
              <div className="plx-actionrow">
                <Button variant="secondary" leftIcon={<RefreshCw size={16} aria-hidden />} loading={busy === "rebuild"} disabled={building} onClick={rebuild}>Rebuild</Button>
                <Button variant="ghost" leftIcon={<ScrollText size={16} aria-hidden />} onClick={() => setShowLog((v) => !v)} aria-expanded={showLog}>{showLog ? "Hide build log" : "Show build log"}</Button>
              </div>
            ) : null}
            {server && showLog ? (
              <div style={{ marginTop: 14 }}>
                {buildId ? <p className="plx-small" style={{ marginBottom: 6 }}>Build {live.status ? (live.status === "SUCCEEDED" ? "worked" : "didn't work") : "running"}{live.summary ? `: ${live.summary}` : ""}</p> : null}
                <pre ref={logRef} className="plx-log" tabIndex={0} aria-label="Build log">{buildId ? (live.lines.length ? live.lines.join("\n") : "Waiting for the build to start…") : "No build has run since you opened this page. Rebuild or upload a new version and its log shows here."}</pre>
              </div>
            ) : null}
          </Card>
          {server ? <AppVariables siteId={siteId} onRebuild={rebuild} /> : null}
        </div>
        {server ? (
          <div className="plx-hub__col">
            <AppGitHub siteId={siteId} git={git} onChanged={refreshGit} onBuildStarted={(id) => { setBuildId(id); setShowLog(true); }} />
            <Card data-tour="hub-app-always">
              <CardHeader title="Always on" description="Make sure your app is ready the moment someone visits." />
              <p className="plx-body" role="status">{ao.text}</p>
              {alwaysOn?.request === "APPROVED" && alwaysOn.status === "FAILED" && alwaysOn.error ? <p className="plx-field__error" role="alert">{alwaysOn.error}</p> : null}
              {ao.action ? <div style={{ marginTop: 14 }}><Button variant="secondary" leftIcon={<Rocket size={16} aria-hidden />} loading={busy === "always"} disabled={building} onClick={() => always(ao.action === "turn-off" ? "turnOff" : undefined)}>{ao.action === "turn-off" ? "Turn off always on" : "Ask for always on"}</Button></div> : null}
            </Card>
          </div>
        ) : null}
      </div>

      <Modal
        open={uploadOpen}
        onClose={() => busy === null && setUploadOpen(false)}
        title="Upload a new version"
        description={server ? "A .zip of your app's code with package.json at the top. Leave out node_modules and build folders. We build it and put it online when it works." : "A .zip of your finished app's files. It goes online straight away."}
        closeOnBackdrop={false}
        footer={<><Button variant="secondary" disabled={busy !== null} onClick={() => setUploadOpen(false)}>Cancel</Button><Button loading={busy === "upload"} onClick={upload}>{server ? "Upload and build" : "Upload and go online"}</Button></>}
      >
        <div className="plx-form">
          <input ref={fileRef} type="file" accept=".zip,application/zip" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <div className="plx-pt__file"><Button variant="secondary" leftIcon={<Upload size={18} aria-hidden />} onClick={() => fileRef.current?.click()}>{file ? "Choose another file" : "Choose a .zip file"}</Button><span className="plx-small">{file ? file.name : "No file chosen yet"}</span></div>
          {!server && file && file.size > 4_000_000 ? <div className="plx-inlinemsg plx-inlinemsg--warn">That file is big. Use the full uploader instead: <a href={`/dashboard/templates/${siteId}/detail`}>open it here</a>, then come back with the Back button.</div> : null}
          <label className="plx-toggle" style={{ alignItems: "flex-start" }}><span className="plx-small">I agree to the <a href="/legal/acceptable-use" target="_blank" rel="noreferrer">rules for what&apos;s allowed</a>. My app runs on Plexo&apos;s servers exactly as I wrote it.</span><input type="checkbox" className="plx-switch" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} aria-label="I agree to the rules" /></label>
          {progress ? <p className="plx-small" role="status">{progress}</p> : null}
          {error ? <p className="plx-field__error" role="alert">{error}</p> : null}
        </div>
      </Modal>

      <Modal open={pageOpen} onClose={() => setPageOpen(false)} title="Add a page to your app" description="Pages in an app are part of its code, so they're added there, not here." footer={<Button variant="secondary" onClick={() => setPageOpen(false)}>Close</Button>}>
        <div className="plx-modal-stack">
          <p className="plx-body">Add the page to your project, then {server ? (git?.linked ? "save it on GitHub and your app updates by itself." : "upload a new version.") : "upload a new version."}</p>
          <div className="plx-hub__actions">
            {git?.linked && git.repo ? <ButtonLink href={`https://github.com/${git.repo}`} target="_blank" rel="noreferrer" leftIcon={<Code2 size={18} aria-hidden />}>Open code on GitHub</ButtonLink> : null}
            <ButtonLink href={solPage} variant={git?.linked ? "secondary" : "primary"} leftIcon={<MessagesSquare size={18} aria-hidden />}>Ask SOL to add a page</ButtonLink>
          </div>
        </div>
      </Modal>
    </>
  );
}
