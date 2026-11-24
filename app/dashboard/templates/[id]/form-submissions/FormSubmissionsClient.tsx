"use client";

import { useEffect, useMemo, useState } from "react";
import { Inbox, Mail, Trash2 } from "lucide-react";
import { Badge, Button, ButtonLink, Card, EmptyState, Modal, Notice, Skeleton } from "@/app/dashboard/_v3/ui";
import { Pagination } from "../../../_components/Pagination";
import { fieldLabel, submitterOf, visibleFields } from "@/lib/forms/technicalFields";

type Submission = { id: string; formName: string; fields: Record<string, string>; createdAt: string; likelySpam: boolean };

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/** The one line that says what the message is about: the message itself if there is one, else the first answers. */
function previewOf(fields: Array<[string, string]>, skip: Set<string>): string {
  const message = fields.find(([k]) => /message|comment|enquiry|inquiry|details|tell us|need/i.test(k));
  const value = message ? message[1] : fields.filter(([, v]) => !skip.has(v)).map(([, v]) => v).join(" · ");
  return value.length > 150 ? `${value.slice(0, 150)}…` : value;
}

const initialOf = (s: string) => (s.trim().charAt(0) || "?").toUpperCase();

/** Messages people sent through the site's forms: who, what about, when. Opens one to read it all; the technical extras forms send along are never shown. */
export function FormSubmissionsClient({ templateId }: { templateId: string }) {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [viewing, setViewing] = useState<Submission | null>(null);
  const [paging, setPaging] = useState({ page: 1, pageSize: 25 });
  const [total, setTotal] = useState(0);
  const [likelySpamIds, setLikelySpamIds] = useState<string[]>([]);

  function load(next = paging) {
    setLoading(true);
    setError(null);
    fetch(`/api/v1/templates/${templateId}/form-submissions?page=${next.page}&pageSize=${next.pageSize}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "We couldn't load your messages.");
        setSubmissions(data.submissions);
        setTotal(data.total);
        setLikelySpamIds(data.likelySpamIds ?? []);
        setPaging({ page: data.page, pageSize: data.pageSize });
      })
      .catch((err) => setError(err instanceof Error ? err.message : "We couldn't load your messages."))
      .finally(() => setLoading(false));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [templateId]);

  const rows = useMemo(
    () => submissions.map((s) => {
      const fields = visibleFields(s.fields);
      const who = submitterOf(fields);
      return { s, fields, who, title: who.name || who.email || "Someone", preview: previewOf(fields, new Set([who.name ?? "", who.email ?? ""])) };
    }),
    [submissions],
  );

  const toggle = (id: string) => setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const stopSelecting = () => { setSelecting(false); setSelected(new Set()); };

  async function deleteSelected() {
    if (!selected.size || !confirm(`Delete ${selected.size} message${selected.size === 1 ? "" : "s"}? This can't be undone.`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/v1/templates/${templateId}/form-submissions`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [...selected] }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "We couldn't delete those.");
      stopSelecting();
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "We couldn't delete those.");
    } finally {
      setDeleting(false);
    }
  }

  if (loading && submissions.length === 0) return <Card><Skeleton height={64} /></Card>;
  if (error) return <Notice kind="error" title="We couldn't load your messages">{error}</Notice>;
  if (submissions.length === 0) {
    return (
      <Card>
        <EmptyState compact title="No messages yet" body="When someone fills in a form on your site, their message shows up here and is emailed to you." illustration={<Inbox size={40} aria-hidden />} />
      </Card>
    );
  }

  const detail = viewing ? (() => { const fields = visibleFields(viewing.fields); return { fields, who: submitterOf(fields) }; })() : null;

  return (
    <div className="plx-adv__stack" data-testid="form-inbox">
      {likelySpamIds.length > 0 && !selecting ? (
        <Notice kind="warning" title={`${likelySpamIds.length} ${likelySpamIds.length === 1 ? "message looks" : "messages look"} like spam`}>
          <Button size="sm" variant="secondary" onClick={() => { setSelecting(true); setSelected(new Set(likelySpamIds)); }}>Review and delete</Button>
        </Notice>
      ) : null}

      <Card padding="none">
        <div className="plx-inbox__bar">
          <b>{total} {total === 1 ? "message" : "messages"}</b>
          {selecting ? (
            <div className="plx-inbox__actions">
              <span className="plx-small">{selected.size} selected</span>
              <Button size="sm" variant="secondary" leftIcon={<Trash2 size={15} aria-hidden />} loading={deleting} disabled={!selected.size} onClick={() => void deleteSelected()}>Delete</Button>
              <Button size="sm" variant="secondary" onClick={stopSelecting}>Done</Button>
            </div>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => setSelecting(true)}>Select</Button>
          )}
        </div>
        {rows.map(({ s, who, title, preview }) => (
          <div key={s.id} className="plx-inbox__row">
            {selecting ? <input type="checkbox" className="plx-inbox__check" aria-label={`Select the message from ${title}`} checked={selected.has(s.id)} onChange={() => toggle(s.id)} /> : null}
            <button type="button" className="plx-inbox__open" onClick={() => (selecting ? toggle(s.id) : setViewing(s))}>
              <span className="plx-inbox__avatar" aria-hidden>{initialOf(title)}</span>
              <span className="plx-inbox__text">
                <span className="plx-inbox__top"><b>{title}</b>{s.likelySpam ? <Badge tone="warning">Likely spam</Badge> : null}</span>
                <span className="plx-inbox__preview">{preview || "No message"}</span>
                <span className="plx-small">{s.formName} · {when(s.createdAt)}{who.email && who.name ? ` · ${who.email}` : ""}</span>
              </span>
            </button>
          </div>
        ))}
      </Card>

      <Pagination page={paging.page} pageSize={paging.pageSize} total={total} noun="messages" onChange={(n) => { setPaging(n); load(n); }} disabled={loading} />

      <Modal open={!!viewing} onClose={() => setViewing(null)} title={detail?.who.name || detail?.who.email || "Message"} footer={
        detail?.who.email ? <ButtonLink href={`mailto:${detail.who.email}?subject=${encodeURIComponent(`Re: your ${viewing?.formName ?? ""} message`)}`} leftIcon={<Mail size={16} aria-hidden />}>Reply by email</ButtonLink> : <Button variant="secondary" onClick={() => setViewing(null)}>Close</Button>
      }>
        {viewing && detail ? (
          <div className="plx-adv__stack">
            <p className="plx-small" style={{ margin: 0 }}>{viewing.formName} · {when(viewing.createdAt)}</p>
            {detail.fields.length === 0 ? <p className="plx-body">This message came through empty.</p> : (
              <dl className="plx-inbox__fields">
                {detail.fields.map(([k, v]) => (
                  <div key={k}>
                    <dt>{fieldLabel(k)}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
