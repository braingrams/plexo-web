"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowRight, FileText, Plus, SearchCheck, Trash2, Upload } from "lucide-react";
import { GateOrError } from "@/app/dashboard/_components/UpgradePrompt";
import { Badge, Button, Card, CardHeader, EmptyState, Input, Modal, Notice, SegmentedControl, Skeleton, Textarea, useToast } from "../../ui";
import { errMsg, hubApi } from "../hubApi";
import { parseBulkRedirects } from "@/lib/redirects/bulk";

export type RedirectRow = { fromPath: string; toPath: string; createdAt: string; permanent: boolean };
type Missing = { path: string; count: number; lastSeen: string; referrer: string | null };
type Broken = { href: string; pages: string[]; suggestion: string | null };

const KINDS = [
  { value: "301", label: "For good" },
  { value: "302", label: "For now" },
] as const;

const slash = (s: string) => (s.trim() && !s.trim().startsWith("/") && !/^https?:\/\//i.test(s.trim()) ? `/${s.trim()}` : s.trim());
const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });

/** Old addresses that should lead somewhere new, the pages people couldn't find, and a check for links on your own pages that go nowhere. */
export function RedirectsSection({ siteId, initial }: { siteId: string; initial: RedirectRow[] }) {
  const { show } = useToast();
  const base = `/api/v1/templates/${siteId}`;
  const [rows, setRows] = useState(initial);
  const [editing, setEditing] = useState<{ from: string; to: string; kind: "301" | "302"; isNew: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkKind, setBulkKind] = useState<"301" | "302">("301");
  const [missing, setMissing] = useState<Missing[] | null>(null);
  const [audit, setAudit] = useState<{ checkedPages: number; broken: Broken[] } | null>(null);
  const [auditing, setAuditing] = useState(false);

  const url = (p: string) => `${base}/redirects/${p.split("/").filter(Boolean).map(encodeURIComponent).join("/")}`;
  const loadMissing = useCallback(async () => {
    try {
      setMissing((await hubApi<{ items: Missing[] }>(`${base}/redirect-tools/not-found`)).items);
    } catch {
      setMissing([]);
    }
  }, [base]);
  useEffect(() => { void loadMissing(); }, [loadMissing]);

  async function save() {
    if (!editing) return;
    const from = slash(editing.from);
    const to = slash(editing.to);
    if (!from) return setError("Type the old address, like /old-page.");
    if (!to) return setError("Type where visitors should go, like /new-page or https://example.com.");
    setBusy(true);
    setError(null);
    const permanent = editing.kind === "301";
    try {
      if (editing.isNew) {
        const d = await hubApi<{ redirect: RedirectRow }>(`${base}/redirects`, { method: "POST", json: { fromPath: from, toPath: to, permanent } }, "We couldn't save that redirect.");
        setRows((r) => [{ ...d.redirect, permanent: d.redirect.permanent !== false }, ...r]);
      } else {
        const d = await hubApi<{ redirect: RedirectRow }>(url(editing.from), { method: "PATCH", json: { toPath: to, permanent } }, "We couldn't save that redirect.");
        setRows((r) => r.map((x) => (x.fromPath === editing.from ? { ...x, toPath: d.redirect.toPath, permanent } : x)));
      }
      setEditing(null);
      setMissing((m) => m?.filter((x) => x.path !== from) ?? m);
      show({ title: "Saved. Visitors to the old address now go to the new one.", tone: "success" });
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(r: RedirectRow) {
    if (!window.confirm(`Stop sending ${r.fromPath} to ${r.toPath}? Visitors to ${r.fromPath} will see a "page not found" message.`)) return;
    try {
      await hubApi(url(r.fromPath), { method: "DELETE" }, "We couldn't remove that.");
      setRows((x) => x.filter((y) => y.fromPath !== r.fromPath));
    } catch (e) {
      show({ title: errMsg(e), tone: "danger" });
    }
  }

  const preview = bulkText.trim() ? parseBulkRedirects(bulkText, bulkKind === "301") : null;
  async function saveBulk() {
    setBusy(true);
    try {
      const d = await hubApi<{ created: number; skipped: string[]; problems: unknown[] }>(`${base}/redirect-tools/bulk`, { method: "POST", json: { text: bulkText, permanent: bulkKind === "301" } }, "We couldn't add those.");
      show({ title: `${d.created} redirect${d.created === 1 ? "" : "s"} added${d.skipped.length ? `, ${d.skipped.length} already existed` : ""}`, tone: "success" });
      setBulkOpen(false);
      setBulkText("");
      const fresh = await hubApi<{ redirects: RedirectRow[] }>(`${base}/redirects`);
      setRows(fresh.redirects.map((r) => ({ ...r, permanent: r.permanent !== false })));
      void loadMissing();
    } catch (e) {
      show({ title: errMsg(e), tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  async function ignore(path: string) {
    setMissing((m) => m?.filter((x) => x.path !== path) ?? m);
    await hubApi(`${base}/redirect-tools/not-found`, { method: "DELETE", json: { path } }).catch(() => undefined);
  }

  async function runAudit() {
    setAuditing(true);
    try {
      setAudit(await hubApi(`${base}/redirect-tools/audit`, undefined, "We couldn't check your links."));
    } catch (e) {
      show({ title: errMsg(e), tone: "danger" });
    } finally {
      setAuditing(false);
    }
  }

  const startNew = (from = "", to = "") => { setError(null); setEditing({ from, to, kind: "301", isNew: true }); };

  return (
    <div className="plx-adv__stack" data-testid="redirects-section">
      <Card>
        <CardHeader
          title="Send old addresses to new ones"
          description="Changed a page's address, or moved from another site? Send people (and Google) from the old address to the new one, so no link breaks."
          action={<div className="plx-adv__actions"><Button variant="secondary" leftIcon={<Upload size={16} aria-hidden />} onClick={() => setBulkOpen(true)}>Add many</Button><Button leftIcon={<Plus size={16} aria-hidden />} onClick={() => startNew()}>Add a redirect</Button></div>}
        />
        {rows.length === 0 ? (
          <EmptyState compact title="No redirects yet" body="When you rename or remove a page, add one here so old links and Google results still reach you." />
        ) : (
          <div>
            {rows.map((r) => (
              <div key={r.fromPath} className="plx-adv__row">
                <div className="plx-adv__grow">
                  <b style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", overflowWrap: "anywhere" }}>{r.fromPath} <ArrowRight size={14} aria-hidden /> {r.toPath}</b>
                  <span>Added {when(r.createdAt)}</span>
                </div>
                <Badge tone={r.permanent ? "brand" : "neutral"}>{r.permanent ? "For good" : "For now"}</Badge>
                <Button variant="secondary" size="sm" onClick={() => { setError(null); setEditing({ from: r.fromPath, to: r.toPath, kind: r.permanent ? "301" : "302", isNew: false }); }}>Change</Button>
                <Button variant="secondary" size="sm" iconOnly aria-label={`Remove the redirect from ${r.fromPath}`} onClick={() => void remove(r)}><Trash2 size={16} aria-hidden /></Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Pages people couldn't find" description="Addresses visitors asked for that don't exist on your site, in the last 30 days. Send them somewhere useful." />
        {missing === null ? (
          <Skeleton height={56} />
        ) : missing.length === 0 ? (
          <p className="plx-body">Nothing yet. When someone lands on an address that isn&apos;t there, it will show up here.</p>
        ) : (
          <div>
            {missing.map((m) => (
              <div key={m.path} className="plx-adv__row">
                <div className="plx-adv__grow">
                  <b style={{ overflowWrap: "anywhere" }}>{m.path}</b>
                  <span>Asked for {m.count} {m.count === 1 ? "time" : "times"}. Last on {when(m.lastSeen)}.{m.referrer ? ` Came from ${m.referrer.replace(/^https?:\/\//, "").slice(0, 60)}.` : ""}</span>
                </div>
                <Button size="sm" onClick={() => startNew(m.path)}>Send visitors somewhere</Button>
                <Button variant="secondary" size="sm" onClick={() => void ignore(m.path)}>Ignore</Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Check my links" description="Looks through your pages for links that lead nowhere, so you can fix them before a visitor finds them." action={<Button variant="secondary" loading={auditing} leftIcon={<SearchCheck size={16} aria-hidden />} onClick={() => void runAudit()}>{audit ? "Check again" : "Check my links"}</Button>} />
        {audit ? (
          audit.broken.length === 0 ? (
            <Notice kind="success" title="Every link works">We looked at {audit.checkedPages} {audit.checkedPages === 1 ? "page" : "pages"} and found no links that go nowhere.</Notice>
          ) : (
            <div>
              <p className="plx-body">{audit.broken.length} {audit.broken.length === 1 ? "link goes" : "links go"} nowhere. We looked at {audit.checkedPages} {audit.checkedPages === 1 ? "page" : "pages"}.</p>
              {audit.broken.map((b) => (
                <div key={b.href} className="plx-adv__row">
                  <div className="plx-adv__grow">
                    <b style={{ overflowWrap: "anywhere" }}>{b.href}</b>
                    <span><FileText size={12} aria-hidden style={{ verticalAlign: "-1px" }} /> On {b.pages.join(", ")}{b.suggestion ? `. Did you mean ${b.suggestion}?` : ""}</span>
                  </div>
                  <Button size="sm" onClick={() => startNew(b.href, b.suggestion ?? "")}>{b.suggestion ? "Send it there" : "Send it somewhere"}</Button>
                </div>
              ))}
            </div>
          )
        ) : null}
      </Card>

      <Modal open={editing !== null} onClose={() => !busy && setEditing(null)} title={editing?.isNew ? "Add a redirect" : "Change this redirect"} footer={<><Button variant="secondary" disabled={busy} onClick={() => setEditing(null)}>Cancel</Button><Button loading={busy} onClick={() => void save()}>Save</Button></>}>
        {editing ? (
          <div className="plx-adv__stack">
            <Input label="Old address" help="The address people use now, like /old-page" value={editing.from} disabled={!editing.isNew} onChange={(e) => setEditing({ ...editing, from: e.target.value })} />
            <Input label="Send them to" help="Another page like /new-page, or a whole address like https://example.com" value={editing.to} onChange={(e) => setEditing({ ...editing, to: e.target.value })} />
            <SegmentedControl label="How long is this move for?" options={KINDS.map((k) => ({ value: k.value, label: k.label }))} value={editing.kind} onChange={(kind) => setEditing({ ...editing, kind })} />
            <p className="plx-small" style={{ margin: 0 }}>{editing.kind === "301" ? "For good: the page has moved for good, and Google moves its search result to the new address. Right for almost every case." : "For now: only a short detour, like a sale page. Google keeps showing the old address."}</p>
            {error ? <GateOrError error={error}><Notice kind="error" title="We couldn't save that">{error}</Notice></GateOrError> : null}
          </div>
        ) : null}
      </Modal>

      <Modal open={bulkOpen} onClose={() => !busy && setBulkOpen(false)} title="Add many redirects" width={640} footer={<><Button variant="secondary" disabled={busy} onClick={() => setBulkOpen(false)}>Cancel</Button><Button loading={busy} disabled={!preview || preview.rows.length === 0} onClick={() => void saveBulk()}>{preview?.rows.length ? `Add ${preview.rows.length}` : "Add"}</Button></>}>
        <div className="plx-adv__stack">
          <Textarea label="One redirect per line" help="Old address first, then the new one: /old-page /new-page. You can paste from a spreadsheet." rows={8} className="plx-adv__mono" spellCheck={false} value={bulkText} placeholder={"/old-about /about\n/summer-sale https://example.com/sale"} onChange={(e) => setBulkText(e.target.value)} />
          <SegmentedControl label="How long are these moves for?" options={KINDS.map((k) => ({ value: k.value, label: k.label }))} value={bulkKind} onChange={setBulkKind} />
          {preview ? (
            <>
              {preview.rows.length ? <Notice kind="success" title={`${preview.rows.length} ready to add`}>Lines ending in 301 or 302 keep their own choice.</Notice> : null}
              {preview.problems.length ? <Notice kind="warning" title="These lines need a look"><ul className="plx-adv__tips">{preview.problems.slice(0, 8).map((p) => <li key={p.line}>Line {p.line}: {p.reason}</li>)}</ul></Notice> : null}
            </>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
