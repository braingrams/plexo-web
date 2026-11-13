"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useBuildLog } from "../templates/[id]/detail/useBuildLog";
import { announceAppLive } from "../_components/AppLiveDialog";

// Shown in the Server app tab in place of the upload form. It streams the build log, which carries the
// address and publish steps too (the finalizer writes them to the same log). When the app is live it
// closes the modal (onLive) and opens the "Your app is live" dialog, which the dashboard layout shows.

type PublishStatus = { publishing: boolean; error: string | null; liveUrl: string | null; previewReady: boolean };

export function ServerBuildProgress({
  templateId,
  buildId,
  detailUrl,
  onTryAgain,
  onLive,
}: {
  templateId: string;
  buildId: string;
  detailUrl: string;
  onTryAgain: () => void;
  onLive?: () => void;
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

  // Live: close the modal first, then show the dialog from the dashboard layout, so it isn't drawn inside the modal.
  const announced = useRef(false);
  useEffect(() => {
    if (!liveUrl || announced.current) return;
    announced.current = true;
    announceAppLive({ liveUrl, detailUrl });
    onLive?.();
  }, [liveUrl, detailUrl, onLive]);

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

    </div>
  );
}

const logStyle: CSSProperties = {
  margin: 0,
  maxHeight: 340,
  overflow: "auto",
  padding: 12,
  borderRadius: 10,
  background: "color-mix(in srgb, var(--bg) 35%, transparent)",
  fontSize: 11.5,
  lineHeight: 1.5,
  whiteSpace: "pre-wrap",
};


const secondaryButton: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "9px 16px",
  borderRadius: 9,
  border: "1px solid var(--surface-border)",
  fontWeight: 650,
  fontSize: 13,
  textDecoration: "none",
  cursor: "pointer",
  background: "transparent",
  color: "inherit",
};


