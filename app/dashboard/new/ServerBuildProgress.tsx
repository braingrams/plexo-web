"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useBuildLog } from "../templates/[id]/detail/useBuildLog";

// Shown in the Server app tab in place of the upload form. It streams the build log, which carries the
// address and publish steps too (the finalizer writes them to the same log), then shows a success dialog
// with the live address and a link to the app's detail page.

type PublishStatus = { publishing: boolean; error: string | null; liveUrl: string | null; previewReady: boolean };

export function ServerBuildProgress({
  templateId,
  buildId,
  detailUrl,
  onTryAgain,
}: {
  templateId: string;
  buildId: string;
  detailUrl: string;
  onTryAgain: () => void;
}) {
  const live = useBuildLog(buildId);
  const logRef = useRef<HTMLPreElement>(null);
  const [publish, setPublish] = useState<PublishStatus | null>(null);

  // Keep the log pinned to its last line as lines arrive, so a quiet stretch never looks stuck.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [live.lines.length]);

  // Once the build has succeeded, the server publishes it. Poll until the address is known or it fails.
  const buildSucceeded = live.status === "SUCCEEDED";
  const buildFailed = live.status === "FAILED";
  useEffect(() => {
    if (!buildSucceeded) return;
    let cancelled = false;
    const check = async () => {
      const res = await fetch(`/api/v1/templates/${templateId}/ssr-publish`).catch(() => null);
      const data = (await res?.json().catch(() => null)) as PublishStatus | null;
      if (cancelled || !data) return;
      setPublish(data);
      if (!data.liveUrl && !data.error) timer = setTimeout(check, 2000);
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    void check();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [buildSucceeded, templateId]);

  const liveUrl = publish?.liveUrl ?? null;
  const publishError = publish?.error ?? null;

  let heading = "Building your app…";
  let detail = "Plexo is building the app on its servers. The log streams below.";
  if (buildFailed) {
    heading = "The build failed";
    detail = live.summary ?? "Read the log for the cause, then try again.";
  } else if (buildSucceeded && publishError) {
    heading = "The app is built, but it didn't go live";
    detail = publishError;
  } else if (buildSucceeded && !liveUrl) {
    heading = "Going live…";
    detail = "Creating the address and publishing the app. The log streams below.";
  }

  return (
    <div style={{ display: "grid", gap: 14, maxWidth: 680 }}>
      <div>
        <h2 style={{ margin: "0 0 4px", fontSize: "17px", fontWeight: 700 }}>{heading}</h2>
        <p style={{ margin: 0, fontSize: "13px", color: "var(--text-muted)" }}>{detail}</p>
      </div>

      <pre ref={logRef} style={logStyle}>
        {live.lines.length ? live.lines.join("\n") : "Waiting for the build to start…"}
      </pre>

      {(buildFailed || publishError) && (
        <div>
          <button type="button" onClick={onTryAgain} style={secondaryButton}>
            Try again
          </button>
        </div>
      )}

      {liveUrl && (
        <div role="dialog" aria-modal="true" aria-label="Your app is live" style={overlayStyle}>
          <div style={dialogStyle}>
            <h3 style={{ margin: "0 0 6px", fontSize: "18px", fontWeight: 700 }}>Your app is live</h3>
            <p style={{ margin: "0 0 20px", fontSize: "13px", color: "var(--text-muted)", lineHeight: 1.5 }}>
              It&apos;s running at its own address now. You can manage its builds, domains and settings from the app&apos;s page.
            </p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <a href={liveUrl} target="_blank" rel="noopener noreferrer" style={primaryButton}>
                Open site
              </a>
              <Link href={detailUrl} style={secondaryButton}>
                Open app details
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const logStyle: CSSProperties = {
  margin: 0,
  maxHeight: 340,
  overflow: "auto",
  padding: 12,
  borderRadius: 10,
  background: "rgba(0,0,0,0.35)",
  fontSize: 11.5,
  lineHeight: 1.5,
  whiteSpace: "pre-wrap",
};

const primaryButton: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "9px 16px",
  borderRadius: 9,
  border: "none",
  fontWeight: 650,
  fontSize: 13,
  textDecoration: "none",
  cursor: "pointer",
  background: "var(--brand)",
  color: "#fff",
};

const secondaryButton: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "9px 16px",
  borderRadius: 9,
  border: "1px solid rgba(255,255,255,0.14)",
  fontWeight: 650,
  fontSize: 13,
  textDecoration: "none",
  cursor: "pointer",
  background: "transparent",
  color: "inherit",
};

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 1000,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(0,0,0,0.55)",
  padding: 20,
};

const dialogStyle: CSSProperties = {
  width: "min(440px, 100%)",
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "var(--surface, #111)",
  padding: "24px 26px",
};
