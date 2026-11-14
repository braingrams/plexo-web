"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { uploadSsrZip, queueSsrBuild } from "@/lib/projects/clientSsrUpload";
import { useBuildLog } from "./useBuildLog";
import { SsrGitHubConnection } from "./SsrGitHubConnection";
import { envFilesDroppedMessage } from "@/lib/projects/envFileNames";
import { ZipDropzone } from "../../../_components/ZipDropzone";

// The deploy section for a server-rendered (SSR) app. Replaces the static-site upload: the zip is a
// Next.js / Remix / Astro / Nuxt / Nitro project, built on the server, and goes live when published.

const card: CSSProperties = { border: "1px solid rgba(255,255,255,0.09)", borderRadius: 14, padding: "20px 22px", marginBottom: 16 };
const heading: CSSProperties = { margin: "0 0 4px", fontSize: 15, fontWeight: 700 };
const muted: CSSProperties = { margin: "0 0 14px", fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5 };
const button = (enabled: boolean): CSSProperties => ({
  padding: "8px 14px", borderRadius: 9, border: "none", fontWeight: 650, fontSize: 13,
  cursor: enabled ? "pointer" : "not-allowed", background: enabled ? "var(--brand)" : "rgba(255,255,255,0.08)", color: enabled ? "#fff" : "var(--text-muted)",
});

type GitConnection = {
  linked: boolean;
  repo?: string;
  branch?: string;
  commitSha?: string | null;
  status?: "OK" | "ERROR";
  statusMessage?: string;
  publishOnPush?: boolean;
  /** The server build queued or running right now, from a push or a manual build. */
  activeBuildId: string | null;
};

// How often the panel asks the server whether a build is running. Cheap, so it stays on while the page is open.
const STATUS_POLL_MS = 3000;

export function SsrDeployPanel({ templateId }: { templateId: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [buildId, setBuildId] = useState<string | null>(null);
  const live = useBuildLog(buildId);
  // The GitHub connection, how the latest push went, and whether a build is running. Polled while the page is open.
  const [git, setGit] = useState<GitConnection | null>(null);
  const refreshGit = useCallback(
    () =>
      fetch(`/api/v1/templates/${templateId}/ssr-git`)
        .then((r) => (r.ok ? (r.json() as Promise<GitConnection>) : null))
        .then((data) => {
          if (data) setGit(data);
        })
        .catch(() => undefined),
    [templateId],
  );
  // One read when the page opens. Polling only runs while a repo is linked, since a push is the only
  // build that starts without this page (see activeBuildId).
  useEffect(() => {
    void refreshGit();
  }, [refreshGit]);
  useEffect(() => {
    if (!git?.linked) return;
    const timer = setInterval(() => void refreshGit(), STATUS_POLL_MS);
    return () => clearInterval(timer);
  }, [git?.linked, refreshGit]);
  // One source at a time: a repo that's already linked opens on GitHub, otherwise the zip upload.
  const [source, setSource] = useState<"zip" | "github">("zip");
  useEffect(() => {
    if (git?.linked) setSource("github");
  }, [git?.linked]);
  // Always-on: the owner asks, Plexo approves by hand. Once approved, the owner can turn it off. The
  // server reports whether the warm copy is starting, on, or failed (and why).
  type AlwaysOnState = { request: "NONE" | "REQUESTED" | "APPROVED" | "DECLINED"; status: "OFF" | "STARTING" | "ON" | "FAILED"; error: string | null };
  const [alwaysOn, setAlwaysOn] = useState<AlwaysOnState | null>(null);
  const [alwaysOnBusy, setAlwaysOnBusy] = useState(false);
  const [alwaysOnTurningOff, setAlwaysOnTurningOff] = useState(false);
  const [alwaysOnError, setAlwaysOnError] = useState<string | null>(null);
  const refreshAlwaysOn = useCallback(
    () =>
      fetch(`/api/v1/templates/${templateId}/ssr-always-on`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!data) return;
          setAlwaysOn({ request: data.request, status: data.status ?? "OFF", error: data.error ?? null });
          // Turning off is done once the server no longer reports the request as approved.
          if (data.request !== "APPROVED") setAlwaysOnTurningOff(false);
        })
        .catch(() => undefined),
    [templateId],
  );
  useEffect(() => {
    void refreshAlwaysOn();
  }, [refreshAlwaysOn]);
  // Poll while the warm copy is starting, or while it's being turned off.
  useEffect(() => {
    const busy = alwaysOn?.status === "STARTING" || alwaysOnTurningOff;
    if (!busy) return;
    const timer = setInterval(() => void refreshAlwaysOn(), 5000);
    return () => clearInterval(timer);
  }, [alwaysOn?.status, alwaysOnTurningOff, refreshAlwaysOn]);
  async function requestAlwaysOn() {
    setAlwaysOnBusy(true);
    setAlwaysOnError(null);
    const res = await fetch(`/api/v1/templates/${templateId}/ssr-always-on`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setAlwaysOnBusy(false);
    if (!res.ok) return setAlwaysOnError(data.error ?? `The request failed (server responded ${res.status}).`);
    await refreshAlwaysOn();
  }
  async function turnOffAlwaysOn() {
    if (!window.confirm("Turn off always on? The app goes back to cold starts. You'll need to request it again to turn it back on.")) return;
    setAlwaysOnBusy(true);
    setAlwaysOnError(null);
    const res = await fetch(`/api/v1/templates/${templateId}/ssr-always-on`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "turnOff" }),
    });
    const data = await res.json().catch(() => ({}));
    setAlwaysOnBusy(false);
    if (!res.ok) return setAlwaysOnError(data.error ?? `Turning off failed (server responded ${res.status}).`);
    setAlwaysOnTurningOff(true);
    await refreshAlwaysOn();
  }
  // A build started from this page (upload or rebuild) is watched until it reports a final status.
  // A build started by a push is attached to as soon as the server reports it as running.
  const pageBuildRef = useRef(false);
  // Whenever the server reports a running build that isn't the one on screen (a push, or a build from another
  // tab), show that one. The page's own build is no longer the one on screen once another build starts.
  useEffect(() => {
    const running = git?.activeBuildId ?? null;
    if (running && running !== buildId) {
      pageBuildRef.current = false;
      setBuildId(running);
    }
  }, [git?.activeBuildId, buildId]);
  // Building: the page's own build still hasn't reported a final status, or the server says a build is running.
  // While it runs the controls are hidden and the log streams.
  const building =
    (buildId !== null && live.status === null && (pageBuildRef.current || git?.activeBuildId === buildId)) ||
    (git?.activeBuildId != null && git.activeBuildId === buildId);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState<null | "upload">(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Keep the build log pinned to its last line as lines arrive, so a quiet stretch never looks stuck.
  const logRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [live.lines.length]);

  async function upload() {
    if (!file || !agreed) return;
    setBusy("upload"); setError(null); setNotice(null); setWarnings([]);
    const sent = await uploadSsrZip(templateId, file, (done, total) => setProgress(`Uploading ${done} of ${total}…`));
    if (!sent.ok) { setBusy(null); setProgress(null); return setError(sent.error); }
    if (sent.data.dropped.length) setNotice(envFilesDroppedMessage(sent.data.dropped));
    setProgress("Queuing the build…");
    const queued = await queueSsrBuild(templateId, sent.data.uploadKey);
    setBusy(null); setProgress(null);
    if (!queued.ok) return setError(queued.error);
    setNotice(queued.data.message);
    setWarnings(queued.data.warnings);
    pageBuildRef.current = true;
    setBuildId(queued.data.buildId);
    setFile(null);
  }


  return (
    <div style={card}>
      <h3 style={heading}>Server app</h3>
      <p style={muted}>
        Upload the app's source as a .zip (package.json at the root, or inside one folder). Leave out node_modules, .git and build output.
        The server builds it and puts it live as soon as the build succeeds.
      </p>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
        <div>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Always on</p>
          <p style={{ margin: "2px 0 0", fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5 }}>
            {alwaysOnTurningOff
              ? "Turning off. The app goes back to cold starts shortly."
              : alwaysOn?.request === "APPROVED" && alwaysOn.status === "STARTING"
                ? "Approved. Starting the warm copy. This takes a few minutes."
                : alwaysOn?.request === "APPROVED" && alwaysOn.status === "ON"
                  ? "On. One warm copy keeps the app responding without a cold start."
                  : alwaysOn?.request === "APPROVED" && alwaysOn.status === "FAILED"
                    ? "Approved, but the warm copy isn't on yet."
                    : alwaysOn?.request === "APPROVED"
                      ? "Approved. The warm copy is being set up."
                      : alwaysOn?.request === "REQUESTED"
                        ? "Requested. Plexo reviews these by hand, then turns it on."
                        : alwaysOn?.request === "DECLINED"
                          ? "Not approved for this app. Ask Plexo support if you need it."
                          : "Keep one warm copy running so visitors never wait for a cold start. Plexo reviews each request by hand."}
          </p>
          {alwaysOn?.request === "APPROVED" && alwaysOn.status === "FAILED" && alwaysOn.error ? (
            <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "#f87171" }}>{alwaysOn.error}</p>
          ) : null}
          {alwaysOnError ? <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "#f87171" }}>{alwaysOnError}</p> : null}
        </div>
        {alwaysOn?.request === "APPROVED" ? (
          <button type="button" onClick={() => void turnOffAlwaysOn()} disabled={alwaysOnBusy || alwaysOnTurningOff || building} style={button(!alwaysOnBusy && !alwaysOnTurningOff && !building)}>
            {alwaysOnTurningOff ? "Turning off…" : "Turn off always on"}
          </button>
        ) : alwaysOn && (alwaysOn.request === "NONE" || alwaysOn.request === "DECLINED") ? (
          <button type="button" onClick={() => void requestAlwaysOn()} disabled={alwaysOnBusy || building} style={button(!alwaysOnBusy && !building)}>
            {alwaysOnBusy ? "Requesting…" : "Request always on"}
          </button>
        ) : null}
      </div>

      {git?.linked ? (
        <div style={{ marginBottom: 14 }}>
          <p style={{ margin: "0 0 6px", fontSize: 12.5, color: "var(--text-muted)" }}>
            Connected to {git.repo} on {git.branch}. {git.publishOnPush ? "Each push to that branch builds and goes live on its own." : "Each push to that branch builds. You publish it yourself."}
          </p>
          {git.statusMessage ? (
            <p style={{ margin: 0, fontSize: 12.5, color: git.status === "ERROR" ? "#f87171" : "var(--text-muted)" }}>{git.statusMessage}</p>
          ) : null}
        </div>
      ) : null}

      {error ? <p style={{ margin: "0 0 12px", fontSize: 12.5, color: "#f87171" }}>{error}</p> : null}
      {notice ? <p style={{ margin: "0 0 12px", fontSize: 12.5, color: "var(--brand)" }}>{notice}</p> : null}
      {warnings.map((w) => (
        <p key={w} style={{ margin: "0 0 8px", fontSize: 12.5, color: "#fbbf24" }}>{w}</p>
      ))}
      {progress ? <p style={{ margin: "0 0 12px", fontSize: 12.5, color: "var(--text-muted)" }}>{progress}</p> : null}
      {!building ? (
        <div role="tablist" aria-label="Source" style={{ display: "flex", gap: 6, marginBottom: 14 }}>
          {(["zip", "github"] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={source === option}
              onClick={() => setSource(option)}
              style={{
                padding: "7px 14px",
                borderRadius: 9,
                border: `1px solid ${source === option ? "var(--brand)" : "var(--surface-border)"}`,
                background: source === option ? "var(--brand-subtle)" : "transparent",
                color: source === option ? "var(--text-main)" : "var(--text-muted)",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {option === "zip" ? "Upload a .zip" : "Connect GitHub"}
            </button>
          ))}
        </div>
      ) : null}
      {!building && source === "github" ? (
        <SsrGitHubConnection
          templateId={templateId}
          onBuildStarted={(id) => {
            // The build runs from this page: show its log, and read the status now that a repo is linked.
            pageBuildRef.current = true;
            setBuildId(id);
            void refreshGit();
          }}
        />
      ) : null}

      {buildId ? (
        <div style={{ marginBottom: 14 }}>
          <p style={{ margin: "0 0 6px", fontSize: 12.5, color: "var(--text-muted)" }}>
            Build {live.status ? (live.status === "SUCCEEDED" ? "succeeded" : "failed") : "running"}
            {live.summary ? `: ${live.summary}` : ""}
          </p>
          <pre ref={logRef} style={{ margin: 0, maxHeight: 280, overflow: "auto", padding: 12, borderRadius: 10, background: "rgba(0,0,0,0.35)", fontSize: 11.5, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
            {live.lines.length ? live.lines.join("\n") : "Waiting for the build to start…"}
          </pre>
        </div>
      ) : null}

      {!building && source === "zip" ? (
        <>
        <div style={{ marginBottom: 14 }}>
          <ZipDropzone file={file} onFile={setFile} accept=".zip,application/zip" hint=".zip, with package.json at its root" disabled={busy !== null} />
        </div>
        <label style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.6, cursor: "pointer", marginBottom: 14 }}>
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} disabled={busy !== null} style={{ marginTop: 3, width: 15, height: 15, flexShrink: 0 }} />
          <span>
            I agree to the{" "}
            <Link href="/legal/acceptable-use" target="_blank" style={{ color: "var(--brand)" }}>Acceptable Use Policy</Link>
            . The app's code is built and run on Plexo's servers exactly as uploaded.
          </span>
        </label>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" onClick={() => void upload()} disabled={!file || !agreed || busy !== null} style={button(!!file && agreed && busy === null)}>
            {busy === "upload" ? "Uploading…" : "Upload and publish"}
          </button>
        </div>
        </>
      ) : null}
    </div>
  );
}
