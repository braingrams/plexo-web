"use client";

import { useEffect, useRef, useState } from "react";
import { Button, ButtonLink, Card, CardHeader, Notice, Textarea } from "@/app/dashboard/_v3/ui";

type Snippet = { index: number; ok: boolean; summary: string; error?: string };
type Fix = { label: string; href: string; reason: "plan" | "domain" };
type State = {
  head: string;
  footer: string;
  blocked: string | null;
  blockedFix: Fix | null;
  domain: string | null;
  onCheckout: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
  headSnippets: Snippet[];
  footerSnippets: Snippet[];
};
type Check = { ok: boolean; error: string | null; snippets: Snippet[] };

/** Ready-made starting points. Each says where to find the real value, and which box it belongs in. */
const EXAMPLES: { id: string; label: string; box: "head" | "footer"; code: string; help: string }[] = [
  {
    id: "google",
    label: "Google Search Console",
    box: "head",
    code: '<meta name="google-site-verification" content="PASTE-YOUR-CODE-HERE" />',
    help: "In Google Search Console choose \"Add property\", then \"HTML tag\". Copy the whole line it shows and paste it here, replacing this example.",
  },
  {
    id: "facebook",
    label: "Facebook domain verification",
    box: "head",
    code: '<meta name="facebook-domain-verification" content="PASTE-YOUR-CODE-HERE" />',
    help: "In Meta Business Settings go to Brand safety, then Domains, and choose the meta-tag method. Copy the line it shows and paste it here.",
  },
  {
    id: "meta-pixel",
    label: "Meta (Facebook) pixel",
    box: "head",
    code: "<!-- Paste the whole pixel code from Meta Events Manager here. It starts with <script> and ends with </noscript>. -->",
    help: "In Meta Events Manager open your pixel, choose \"Install code manually\" and copy everything. Paste it here, replacing this example.",
  },
  {
    id: "hotjar",
    label: "Hotjar",
    box: "head",
    code: "<!-- Paste the Hotjar tracking code here. It starts with <script> and ends with </script>. -->",
    help: "In Hotjar open Sites and Organizations, then your site, and copy the tracking code. Paste it here, replacing this example.",
  },
];

/** "Header code" and "Footer code": verification tags, pixels and chat widgets. Starter and above, your own domain only. */
export function CustomCodeCard({ templateId }: { templateId: string }) {
  const [state, setState] = useState<State | null>(null);
  const [head, setHead] = useState("");
  const [footer, setFooter] = useState("");
  const [onCheckout, setOnCheckout] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [checks, setChecks] = useState<{ head: Check; footer: Check } | null>(null);
  const [help, setHelp] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/site-layout/${templateId}/custom-code`)
      .then((r) => (r.ok ? r.json() : null))
      .then((s: State | null) => {
        if (cancelled || !s) return;
        setState(s);
        setHead(s.head);
        setFooter(s.footer);
        setOnCheckout(s.onCheckout);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [templateId]);

  // Checks what was pasted a moment after typing stops, so mistakes show up before Save.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!head.trim() && !footer.trim()) return setChecks(null);
    timer.current = setTimeout(() => {
      void fetch(`/api/site-layout/${templateId}/custom-code/check`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ head, footer }) })
        .then((r) => (r.ok ? r.json() : null))
        .then((c) => c && setChecks(c))
        .catch(() => undefined);
    }, 500);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [head, footer, templateId]);

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/site-layout/${templateId}/custom-code`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ head, footer, onCheckout }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setMessage({ kind: "error", text: data.error ?? "Couldn't save your code. Try again." });
      else {
        setState(data);
        setHead(data.head);
        setFooter(data.footer);
        setMessage({ kind: "ok", text: `Saved. It shows up on your live site${data.domain ? ` at ${data.domain}` : ""} within a minute.` });
      }
    } finally {
      setSaving(false);
    }
  }

  function useExample(id: string) {
    const ex = EXAMPLES.find((e) => e.id === id);
    if (!ex) return;
    const set = ex.box === "head" ? setHead : setFooter;
    set((cur) => (cur.trim() ? `${cur.trim()}\n${ex.code}` : ex.code));
    setHelp(ex.help);
  }

  const locked = !!state?.blocked;
  const hasProblem = !!checks && (!checks.head.ok || !checks.footer.ok);
  const dirty = state !== null && (head.trim() !== state.head.trim() || footer.trim() !== state.footer.trim() || onCheckout !== state.onCheckout);
  const notes = (c: Check | undefined, saved: Snippet[], text: string) => {
    const list = c && text.trim() ? c.snippets : saved;
    if (!list.length) return null;
    return (
      <ul className="plx-code__list">
        {list.map((sn) => (
          <li key={sn.index} style={{ color: sn.ok ? "var(--plx-success)" : "var(--plx-danger)" }}>{sn.ok ? `Understood: ${sn.summary}` : sn.error}</li>
        ))}
      </ul>
    );
  };

  return (
    <Card>
      <CardHeader
        title="Add your own code"
        description="Some services ask you to put a small piece of code on your website, to prove it's yours (Google, Facebook) or to count visitors (a pixel, Hotjar). Copy it from the service and paste it below. It works on every kind of site you build here, including apps you uploaded."
      />
      <div className="plx-adv__stack" data-testid="custom-code">
        {state?.blocked ? (
          <Notice kind="warning" title="Not available yet">
            {state.blocked}
            {state.blockedFix ? <div style={{ marginTop: 10 }}><ButtonLink href={state.blockedFix.href} size="sm">{state.blockedFix.label}</ButtonLink></div> : null}
          </Notice>
        ) : null}

        <div>
          <p className="plx-field__label" style={{ margin: "0 0 8px" }}>Start from an example</p>
          <div className="plx-code__examples">
            {EXAMPLES.map((e) => (
              <Button key={e.id} variant="secondary" size="sm" onClick={() => useExample(e.id)} disabled={locked || !state}>{e.label}</Button>
            ))}
          </div>
          {help ? <p role="status" className="plx-small" style={{ margin: "10px 0 0" }}>{help}</p> : null}
        </div>

        <Textarea label="Header code (top of every page)" rows={5} className="plx-adv__mono" spellCheck={false} value={head} disabled={locked || !state} placeholder={'<meta name="google-site-verification" content="…" />'} onChange={(e) => setHead(e.target.value)} />
        {notes(checks?.head, state?.headSnippets ?? [], head)}
        <Textarea label="Footer code (bottom of every page)" rows={5} className="plx-adv__mono" spellCheck={false} value={footer} disabled={locked || !state} placeholder="<script>…</script>" onChange={(e) => setFooter(e.target.value)} />
        {notes(checks?.footer, state?.footerSnippets ?? [], footer)}

        <label className="plx-layoutpart__check">
          <input type="checkbox" checked={onCheckout} onChange={(e) => setOnCheckout(e.target.checked)} disabled={locked || !state} />
          <span>
            <b>Also run on cart, checkout and order pages</b>
            <span className="plx-small" style={{ display: "block", marginTop: 2 }}>Off by default, so nothing but Plexo sees your customers&apos; details while they pay. Turn it on only if a service needs it, like a purchase pixel.</span>
          </span>
        </label>

        <div className="plx-code__where">
          <b>Where it runs:</b>{" "}
          {state?.domain ? `on every page of ${state.domain}` : "on every page of your own domain once one is connected"}
          {onCheckout ? "." : ", except cart, checkout and order pages."} That covers pages you design, your blog, apps built here and apps you uploaded. Once per page, never inside the editor, and never on your free Plexo address. On an uploaded app, a change can take up to an hour to show. Only paste code from a service you trust: it runs for every visitor. We accept script, meta, link, noscript and style tags, and turn away anything that could redirect visitors.
        </div>

        {message ? <Notice kind={message.kind === "ok" ? "success" : "error"} title={message.text} /> : null}
        <div className="plx-adv__actions">
          <Button loading={saving} disabled={locked || !state || hasProblem || !dirty} onClick={() => void save()}>Save code</Button>
          {hasProblem ? <span className="plx-small" style={{ color: "var(--plx-danger)" }}>Fix the problem above to save.</span> : null}
          {state?.updatedAt && !message ? <span className="plx-small">Last changed {new Date(state.updatedAt).toLocaleString()}{state.updatedBy ? ` by ${state.updatedBy}` : ""}</span> : null}
        </div>
      </div>
    </Card>
  );
}
