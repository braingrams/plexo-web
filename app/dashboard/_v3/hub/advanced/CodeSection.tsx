"use client";

import { GateOrError } from "@/app/dashboard/_components/UpgradePrompt";
import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Check, Copy } from "lucide-react";
import { Button, Card, CardHeader, Notice, OptimisticLoader, SegmentedControl, Skeleton, useToast } from "../../ui";
import { ensureMonaco, languageFor } from "@/app/dashboard/apps/_components/monaco";
import { useMonacoTheme } from "../../../_components/EditorTheme";
import { errMsg, hubApi } from "../hubApi";
import { PagePicker, usePages, type PickerPage } from "./PagePicker";

const Monaco = dynamic(() => import("@monaco-editor/react"), { ssr: false, loading: () => <div className="plx-adv__monaco"><Skeleton height="100%" /></div> });

type Mode = "html" | "json" | "text";
type FileRow = { path: string; size: number; editable: boolean; content?: string };

const plainText = (html: string) => html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

/** The code behind each page. Pages made with the visual editor are shown to read and copy; pages you wrote yourself can be edited. */
export function CodeSection({ siteId }: { siteId: string }) {
  const { pages, error } = usePages(siteId);
  const [pageId, setPageId] = useState<string | null>(null);
  useEffect(() => { if (pages?.length) setPageId((p) => p ?? pages[0].id); }, [pages]);
  const page = pages?.find((p) => p.id === pageId) ?? null;

  if (!pages) return <Card><div style={{ padding: "28px 16px", display: "grid", placeItems: "center" }}><OptimisticLoader title="Loading site code" subtitle="Reading page templates and markup" steps={["Loading pages…", "Preparing code inspector…", "Ready."]} /></div></Card>;
  if (!page) return <Card><p className="plx-body" role="alert">{error ?? "This site has no pages yet."}</p></Card>;
  return (
    <div className="plx-adv__stack">
      <div className="plx-adv__pick"><PagePicker pages={pages} value={page.id} onChange={setPageId} /></div>
      {page.sourceType === "RAW_UPLOAD" ? <OwnCode key={page.id} page={page} /> : <GeneratedCode key={page.id} page={page} />}
    </div>
  );
}

function GeneratedCode({ page }: { page: PickerPage }) {
  const [mode, setMode] = useState<Mode>("html");
  const [data, setData] = useState<{ html: string; design: unknown } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    hubApi<{ page: { compiledHtml: string; designJson?: unknown } }>(`/api/templates/${page.id}?include=design`).then(
      (d) => setData({ html: d.page.compiledHtml, design: d.page.designJson ?? null }),
      (e) => setError(errMsg(e, "We couldn't load this page's code.")),
    );
  }, [page.id]);

  const text = !data ? "" : mode === "html" ? data.html : mode === "json" ? JSON.stringify(data.design, null, 2) : plainText(data.html);
  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* the browser said no */ }
  }
  return (
    <Card>
      <CardHeader
        title="What your page is made of"
        description="This is made for you by the visual editor, so change the page there and this updates. You can copy it to use somewhere else."
        action={<Button variant="secondary" leftIcon={copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />} disabled={!data} onClick={copy}>{copied ? "Copied" : "Copy"}</Button>}
      />
      <div className="plx-adv__stack">
        <SegmentedControl<Mode> label="What to show" value={mode} onChange={setMode} options={[{ value: "html", label: "Page code" }, { value: "json", label: "Design data" }, { value: "text", label: "Just the words" }]} />
        {error ? <p className="plx-field__error" role="alert">{error}</p> : !data ? <div style={{ padding: "40px 16px", display: "grid", placeItems: "center" }}><OptimisticLoader title="Compiling code view" subtitle="Formatting markup and structure" steps={["Fetching source code…", "Formatting syntax…", "Ready."]} /></div> : <pre className="plx-adv__code" tabIndex={0} aria-label="Code">{text || "Nothing here yet."}</pre>}
      </div>
    </Card>
  );
}

function OwnCode({ page }: { page: PickerPage }) {
  const { show } = useToast();
  const monacoTheme = useMonacoTheme();
  ensureMonaco();
  const [files, setFiles] = useState<FileRow[] | null>(null);
  const [active, setActive] = useState("index.html");
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await hubApi<{ files: FileRow[] }>(`/api/v1/templates/${page.id}/files`);
      setFiles(d.files);
      const init: Record<string, string> = {};
      for (const f of d.files) if (f.editable) init[f.path] = f.content ?? "";
      setEdits(init);
      setSaved(init);
    } catch (e) {
      setError(errMsg(e, "We couldn't load your files."));
      setFiles([]);
    }
  }, [page.id]);
  useEffect(() => { void load(); }, [load]);

  const dirty = (p: string) => edits[p] !== undefined && edits[p] !== saved[p];
  async function save() {
    setBusy(true);
    setError(null);
    try {
      const path = active.split("/").map(encodeURIComponent).join("/");
      await hubApi(`/api/v1/templates/${page.id}/files/${path}`, { method: "PUT", json: { content: edits[active] } }, "We couldn't save that file. Please try again.");
      setSaved((s) => ({ ...s, [active]: edits[active] }));
      show({ title: "File saved", tone: "success" });
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  if (!files) return <Card><div style={{ padding: "32px 16px", display: "grid", placeItems: "center" }}><OptimisticLoader title="Loading project files" subtitle="Scanning uploaded files and assets" steps={["Reading project file manifest…", "Preparing editor…", "Ready."]} /></div></Card>;
  const editable = files.filter((f) => f.editable);
  const current = files.find((f) => f.path === active) ?? editable[0];
  return (
    <Card>
      <CardHeader title="Your own code" description="These are the files you uploaded. Change one, save, and your site is updated." action={<Button loading={busy} disabled={!current || !dirty(current.path)} onClick={save}>Save file</Button>} />
      <div className="plx-adv__stack">
        <div className="plx-adv__files" role="group" aria-label="Files">
          {editable.map((f) => (
            <button key={f.path} type="button" className="plx-adv__file" aria-pressed={current?.path === f.path} onClick={() => setActive(f.path)}>{f.path}{dirty(f.path) ? " *" : ""}</button>
          ))}
        </div>
        {files.length > editable.length ? <p className="plx-small">{files.length - editable.length} picture and other files are kept as they are and not shown here.</p> : null}
        {error ? <GateOrError error={error}><Notice kind="error" title="That didn't work">{error}</Notice></GateOrError> : null}
        {current ? (
          <div className="plx-adv__monaco">
            <Monaco
              height="100%"
              theme={monacoTheme}
              path={`${page.id}/${current.path}`}
              language={languageFor(current.path)}
              value={edits[current.path] ?? ""}
              onChange={(v) => setEdits((e) => ({ ...e, [current.path]: v ?? "" }))}
              options={{ minimap: { enabled: false }, fontSize: 13, wordWrap: "on", scrollBeyondLastLine: false, automaticLayout: true }}
            />
          </div>
        ) : <p className="plx-body">There is nothing to edit on this page.</p>}
      </div>
    </Card>
  );
}
