"use client";

import { useEffect, useState } from "react";
import { ExternalLink, PanelRight, X } from "lucide-react";
import type { ActiveArtifact } from "../../sol/_components/ArtifactCanvas";
import { ButtonLink } from "../ui/Button";
import { SegmentedControl } from "../ui/SegmentedControl";

type ArtifactPage = { id: string; name: string; kind: string; compiledHtml: string; previewHtml: string };

/** The small, re-openable card for the page SOL just built. */
export function ArtifactChip({ artifact, onOpen }: { artifact: ActiveArtifact; onOpen: () => void }) {
  return (
    <button type="button" className="sol3-artifact" onClick={onOpen}>
      <PanelRight size={20} aria-hidden />
      <b>{artifact.name}</b>
      <span>See it</span>
    </button>
  );
}

/** The page SOL just built, shown beside the chat. */
export function Canvas({ artifact, onClose }: { artifact: ActiveArtifact; onClose: () => void }) {
  const [page, setPage] = useState<ArtifactPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"preview" | "code">("preview");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPage(null);
    fetch(`/api/templates/${artifact.templateId}?draft=1`)
      .then(async (res) => {
        if (!res.ok) throw new Error("We couldn't show this page just now.");
        const data = (await res.json()) as { page: ArtifactPage };
        if (!cancelled) setPage(data.page);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "We couldn't show this page just now."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [artifact.templateId]);

  return (
    <>
      <div className="sol3-canvas__bar">
        <b>{page?.name ?? artifact.name}</b>
        <SegmentedControl
          label="View"
          value={tab}
          onChange={(v) => setTab(v as "preview" | "code")}
          options={[{ value: "preview", label: "Preview" }, { value: "code", label: "Behind the scenes" }]}
        />
        {artifact.publishedUrl ? (
          <a className="plx-iconbtn" href={artifact.publishedUrl} target="_blank" rel="noopener noreferrer" aria-label="Open the live page">
            <ExternalLink size={19} aria-hidden />
          </a>
        ) : null}
        <ButtonLink size="sm" variant="secondary" href={`/dashboard/templates/${artifact.templateId}`}>
          Edit page
        </ButtonLink>
        <button type="button" className="plx-iconbtn" onClick={onClose} aria-label="Close preview">
          <X size={20} aria-hidden />
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        {loading ? <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }} className="plx-small">Loading your page…</div> : null}
        {error && !loading ? <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", padding: 16, textAlign: "center" }} className="sol3-error">{error}</div> : null}
        {page && !loading && !error && tab === "preview" ? <iframe className="sol3-canvas__frame" key={page.id} srcDoc={page.previewHtml} title={page.name} sandbox="" /> : null}
        {page && !loading && !error && tab === "code" ? (
          <pre style={{ margin: 0, height: "100%", overflow: "auto", padding: 16, fontSize: 12.5, lineHeight: 1.55, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{page.compiledHtml}</pre>
        ) : null}
      </div>
    </>
  );
}
