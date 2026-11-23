"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { GateOrError } from "@/app/dashboard/_components/UpgradePrompt";
import { Button, Card, CardHeader, Input, Notice, SegmentedControl, Skeleton, Textarea, useToast } from "../../ui";
import { buildRobotsTxt, checkFolder, checkRobotsText, DEFAULT_ROBOTS, type RobotsConfig, type RobotsMode } from "@/lib/seo/robots";
import { errMsg, hubApi } from "../hubApi";

const MODES: Array<{ value: RobotsMode; label: string }> = [
  { value: "default", label: "Open to everyone" },
  { value: "folders", label: "Keep some folders out" },
  { value: "custom", label: "Write my own" },
];

const INTRO: Record<RobotsMode, string> = {
  default: "Search engines may read every page. This is right for almost every site, and it is what Plexo does unless you change it.",
  folders: "Everything stays open except the folders you list. Pages under a folder, like /members/ or /private/, are left out of search.",
  custom: "For people who know robots.txt. We check every line, and your sitemap line is always kept.",
};

/** The site's robots file in plain words: who may read what. Shows the exact file before it is saved. */
export function SeoRobotsCard({ siteId, address }: { siteId: string; address: string | null }) {
  const { show } = useToast();
  const [saved, setSaved] = useState<RobotsConfig | null>(null);
  const [draft, setDraft] = useState<RobotsConfig>(DEFAULT_ROBOTS);
  const [folder, setFolder] = useState("");
  const [folderError, setFolderError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      const { config } = await hubApi<{ config: RobotsConfig }>(`/api/v1/templates/${siteId}/robots`);
      setSaved(config);
      setDraft(config);
    } catch (e) {
      setError(errMsg(e, "We couldn't load this."));
      setSaved(DEFAULT_ROBOTS);
    }
  }, [siteId]);
  useEffect(() => { void load(); }, [load]);

  const host = address ?? "yoursite.com";
  const custom = useMemo(() => (draft.mode === "custom" ? checkRobotsText(draft.custom) : null), [draft.mode, draft.custom]);
  const preview = useMemo(() => buildRobotsTxt(host, false, draft), [host, draft]);
  const dirty = saved !== null && JSON.stringify({ ...draft, custom: draft.mode === "custom" ? draft.custom.trim() : "", folders: draft.mode === "folders" ? draft.folders : [] }) !== JSON.stringify({ ...saved, custom: saved.mode === "custom" ? saved.custom : "", folders: saved.mode === "folders" ? saved.folders : [] });

  function addFolder() {
    const f = checkFolder(folder);
    if (!f || f === "/") return setFolderError("Type a folder name like members or /private/. Spaces and symbols aren't allowed.");
    setFolderError(null);
    setDraft((d) => ({ ...d, folders: d.folders.includes(f) ? d.folders : [...d.folders, f].slice(0, 30) }));
    setFolder("");
  }

  async function save(config: RobotsConfig) {
    setBusy(true);
    setError(null);
    try {
      const res = await hubApi<{ config: RobotsConfig; warnings: string[] }>(`/api/v1/templates/${siteId}/robots`, { method: "PUT", json: { config } }, "We couldn't save that. Please try again.");
      setSaved(res.config);
      setDraft(res.config);
      setWarnings(res.warnings ?? []);
      show({ title: "Saved", tone: "success" });
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Who can read your site" description="The robots file tells search engines which parts of your site they may read." />
      {saved === null ? (
        <div style={{ display: "grid", gap: 10 }}><Skeleton height={44} /><Skeleton height={96} /></div>
      ) : (
        <div className="plx-adv__stack" data-testid="robots-card">
          <SegmentedControl label="Who can read your site" options={MODES} value={draft.mode} onChange={(mode) => setDraft({ ...draft, mode })} />
          <p className="plx-small" style={{ margin: 0 }}>{INTRO[draft.mode]}</p>

          {draft.mode === "folders" ? (
            <div className="plx-adv__stack">
              <div className="plx-adv__chips" aria-label="Folders kept out of search">
                {draft.folders.map((f) => (
                  <span key={f} className="plx-adv__chip">
                    {f}
                    <button type="button" aria-label={`Stop keeping ${f} out`} onClick={() => setDraft({ ...draft, folders: draft.folders.filter((x) => x !== f) })}><X size={14} aria-hidden /></button>
                  </span>
                ))}
                {draft.folders.length === 0 ? <span className="plx-small">No folders yet.</span> : null}
              </div>
              <div className="plx-adv__pick">
                <Input label="Add a folder" help="For example members or /private/" value={folder} error={folderError ?? undefined} onChange={(e) => { setFolder(e.target.value); setFolderError(null); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addFolder(); } }} />
                <div><Button variant="secondary" type="button" leftIcon={<Plus size={16} aria-hidden />} onClick={addFolder}>Add folder</Button></div>
              </div>
            </div>
          ) : null}

          {draft.mode === "custom" ? (
            <Textarea label="Your robots file" rows={9} className="plx-adv__mono" spellCheck={false} value={draft.custom} placeholder={"User-agent: *\nDisallow: /private/"} onChange={(e) => setDraft({ ...draft, custom: e.target.value })} />
          ) : null}

          {custom && !custom.ok ? <Notice kind="warning" title="Fix this first"><ul className="plx-adv__tips">{custom.problems.map((p) => <li key={p}>{p}</li>)}</ul></Notice> : null}
          {(custom?.warnings.length ? custom.warnings : warnings).map((w) => <Notice key={w} kind="warning" title="Are you sure?">{w}</Notice>)}
          {error ? <GateOrError error={error}><Notice kind="error" title="We couldn't save that">{error}</Notice></GateOrError> : null}

          <details className="plx-adv__details">
            <summary>See the file search engines will read</summary>
            <pre className="plx-adv__code">{preview}</pre>
          </details>

          <div className="plx-adv__actions">
            <Button type="button" loading={busy} disabled={!dirty || (custom !== null && !custom.ok) || (draft.mode === "folders" && draft.folders.length === 0)} onClick={() => void save(draft)}>Save</Button>
            {saved.mode !== "default" ? <Button variant="secondary" type="button" disabled={busy} onClick={() => void save(DEFAULT_ROBOTS)}>Back to the default</Button> : null}
          </div>
        </div>
      )}
    </Card>
  );
}
