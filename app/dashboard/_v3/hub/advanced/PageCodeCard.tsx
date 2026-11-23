"use client";

import { useEffect, useRef, useState } from "react";
import { GateOrError } from "@/app/dashboard/_components/UpgradePrompt";
import { Button, ButtonLink, Card, CardHeader, Notice, Skeleton, Textarea, useToast } from "../../ui";
import { errMsg, hubApi } from "../hubApi";
import { PagePicker, type PickerPage } from "./PagePicker";

type Snippet = { index: number; ok: boolean; summary: string; error?: string };
type Check = { ok: boolean; error: string | null; snippets: Snippet[] };
type State = { head: string; footer: string; blocked: string | null; blockedFix: { label: string; href: string } | null; domain: string | null };

/** Code for one page only, next to the site-wide code: a pixel for one landing page, a verification tag for one address. */
export function PageCodeCard({ siteId, pages }: { siteId: string; pages: PickerPage[] }) {
  const { show } = useToast();
  const [pageId, setPageId] = useState(pages[0].id);
  const [state, setState] = useState<State | null>(null);
  const [head, setHead] = useState("");
  const [footer, setFooter] = useState("");
  const [checks, setChecks] = useState<{ head: Check; footer: Check } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setState(null);
    setError(null);
    hubApi<State>(`/api/v1/templates/${pageId}/page-code`).then((s) => { setState(s); setHead(s.head); setFooter(s.footer); }, (e) => setError(errMsg(e, "We couldn't load this page's code.")));
  }, [pageId]);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!head.trim() && !footer.trim()) return setChecks(null);
    timer.current = setTimeout(() => {
      hubApi<{ head: Check; footer: Check }>(`/api/site-layout/${siteId}/custom-code/check`, { method: "POST", json: { head, footer } }).then(setChecks, () => undefined);
    }, 500);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [head, footer, siteId]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const s = await hubApi<State>(`/api/v1/templates/${pageId}/page-code`, { method: "PUT", json: { head, footer } }, "We couldn't save this code.");
      setState(s);
      setHead(s.head);
      setFooter(s.footer);
      show({ title: `Saved. It shows on this page within a minute${s.domain ? ` at ${s.domain}` : ""}.`, tone: "success" });
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  const locked = !!state?.blocked;
  const bad = !!checks && (!checks.head.ok || !checks.footer.ok);
  const dirty = state !== null && (head.trim() !== state.head.trim() || footer.trim() !== state.footer.trim());
  const notes = (c: Check | undefined, text: string) => (c && text.trim() ? (
    <ul className="plx-adv__tips" style={{ margin: 0 }}>{c.snippets.map((s) => <li key={s.index} style={{ color: s.ok ? "var(--plx-success)" : "var(--plx-danger)" }}>{s.ok ? `Understood: ${s.summary}` : s.error}</li>)}</ul>
  ) : null);

  return (
    <Card>
      <CardHeader title="Code for one page" description="Only this page gets it, on top of your site-wide header and footer code. Good for a pixel on one landing page or a tag Google asked for on one address." />
      <div className="plx-adv__stack" data-testid="page-code">
        <div className="plx-adv__pick"><PagePicker pages={pages} value={pageId} onChange={setPageId} label="Which page" /></div>
        {state === null && !error ? <Skeleton height={120} /> : null}
        {state?.blocked ? (
          <Notice kind="warning" title="Not available on your plan yet">
            {state.blocked}
            {state.blockedFix ? <div style={{ marginTop: 8 }}><ButtonLink href={state.blockedFix.href} size="sm">{state.blockedFix.label}</ButtonLink></div> : null}
          </Notice>
        ) : null}
        {state ? (
          <>
            <Textarea label="Header code (top of this page)" rows={5} className="plx-adv__mono" spellCheck={false} value={head} disabled={locked} placeholder={'<meta name="google-site-verification" content="…" />'} onChange={(e) => setHead(e.target.value)} />
            {notes(checks?.head, head)}
            <Textarea label="Footer code (bottom of this page)" rows={5} className="plx-adv__mono" spellCheck={false} value={footer} disabled={locked} placeholder="<script>…</script>" onChange={(e) => setFooter(e.target.value)} />
            {notes(checks?.footer, footer)}
            <p className="plx-small" style={{ margin: 0 }}>Runs only on this page, once, and never inside the editor or on your free Plexo address. Cart, checkout and order pages follow the choice you made for the site-wide code. Only paste code from a service you trust.</p>
          </>
        ) : null}
        {error ? <GateOrError error={error}><Notice kind="error" title="We couldn't do that">{error}</Notice></GateOrError> : null}
        {state ? (
          <div className="plx-adv__actions">
            <Button loading={saving} disabled={locked || !dirty || bad} onClick={() => void save()}>Save code for this page</Button>
            {bad ? <span className="plx-small" style={{ color: "var(--plx-danger)" }}>Fix the problem above to save.</span> : null}
          </div>
        ) : null}
      </div>
    </Card>
  );
}
