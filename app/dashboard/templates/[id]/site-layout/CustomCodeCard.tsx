"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

const FIELD_LABEL: React.CSSProperties = { fontSize: "0.75rem", fontWeight: 700, color: "var(--plx-muted)", textTransform: "uppercase", letterSpacing: "0.04em", display: "block", marginBottom: "0.4rem" };
const AREA: React.CSSProperties = { width: "100%", minHeight: 120, padding: "0.6rem 0.75rem", borderRadius: 8, border: "1px solid var(--plx-border)", background: "var(--plx-surface)", color: "inherit", fontFamily: "ui-monospace, monospace", fontSize: "0.78rem", resize: "vertical" };
const CHIP: React.CSSProperties = { padding: "0.35rem 0.7rem", borderRadius: 999, border: "1px solid var(--plx-border)", background: "var(--plx-tint)", color: "var(--plx-text)", fontSize: "0.76rem", fontWeight: 600, cursor: "pointer" };

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
  const notes = (c: Check | undefined, saved: Snippet[], text: string) => {
    const list = c && text.trim() ? c.snippets : saved;
    if (!list.length) return null;
    return (
      <ul style={{ listStyle: "none", margin: "0.4rem 0 0", padding: 0, display: "grid", gap: 3 }}>
        {list.map((s) => (
          <li key={s.index} style={{ fontSize: "0.78rem", lineHeight: 1.45, color: s.ok ? "var(--plx-success)" : "var(--plx-danger)" }}>
            {s.ok ? `Understood: ${s.summary}` : s.error}
          </li>
        ))}
      </ul>
    );
  };

  return (
    <div style={{ border: "1px solid var(--plx-border)", borderRadius: 14, padding: "1.25rem", marginBottom: "1.25rem", background: "var(--plx-surface)" }}>
      <h2 style={{ fontSize: "1rem", fontWeight: 700, color: "var(--plx-text)", margin: "0 0 0.35rem" }}>Add your own code</h2>
      <p style={{ fontSize: "0.82rem", color: "var(--plx-muted)", marginBottom: "0.75rem", lineHeight: 1.55 }}>
        Some services ask you to put a small piece of code on your website, to prove it&apos;s yours (Google, Facebook) or to count visitors (a pixel, Hotjar). Copy it from the service and paste it below. We check it as you paste.
      </p>

      {state?.blocked && state.blockedFix && (
        <div role="note" style={{ padding: "0.8rem 0.95rem", borderRadius: 10, marginBottom: "0.9rem", background: "color-mix(in srgb, var(--plx-warning) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--plx-warning) 30%, transparent)", fontSize: "0.84rem", lineHeight: 1.5 }}>
          {state.blocked}
          <div style={{ marginTop: "0.6rem" }}>
            <Link href={state.blockedFix.href} style={{ display: "inline-block", padding: "0.5rem 1rem", borderRadius: 8, background: "var(--plx-brand)", color: "var(--plx-on-brand)", fontWeight: 700, fontSize: "0.82rem", textDecoration: "none" }}>
              {state.blockedFix.label}
            </Link>
          </div>
        </div>
      )}

      <p style={{ ...FIELD_LABEL, marginBottom: "0.4rem" }}>Start from an example</p>
      <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
        {EXAMPLES.map((e) => (
          <button key={e.id} type="button" style={CHIP} onClick={() => useExample(e.id)} disabled={locked || !state}>{e.label}</button>
        ))}
      </div>
      {help && <p role="status" style={{ fontSize: "0.78rem", color: "var(--plx-muted)", margin: "0 0 0.5rem", lineHeight: 1.5 }}>{help}</p>}

      <label style={{ ...FIELD_LABEL, marginTop: "0.7rem" }} htmlFor="cc-head">Header code (top of every page)</label>
      <textarea id="cc-head" style={AREA} value={head} onChange={(e) => setHead(e.target.value)} disabled={locked || !state} spellCheck={false} placeholder={'<meta name="google-site-verification" content="…" />'} />
      {notes(checks?.head, state?.headSnippets ?? [], head)}
      <label style={{ ...FIELD_LABEL, marginTop: "0.9rem" }} htmlFor="cc-foot">Footer code (bottom of every page)</label>
      <textarea id="cc-foot" style={AREA} value={footer} onChange={(e) => setFooter(e.target.value)} disabled={locked || !state} spellCheck={false} placeholder="<script>…</script>" />
      {notes(checks?.footer, state?.footerSnippets ?? [], footer)}

      <label style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start", marginTop: "1rem", fontSize: "0.82rem", lineHeight: 1.45 }}>
        <input type="checkbox" checked={onCheckout} onChange={(e) => setOnCheckout(e.target.checked)} disabled={locked || !state} style={{ marginTop: 3 }} />
        <span>
          Also run on cart, checkout and order pages
          <span style={{ display: "block", fontSize: "0.75rem", color: "var(--plx-muted)" }}>Off by default, so nothing but Plexo sees your customers&apos; details while they pay. Turn it on only if a service like a Meta pixel needs to track purchases.</span>
        </span>
      </label>

      <div style={{ marginTop: "1rem", padding: "0.7rem 0.9rem", borderRadius: 10, background: "var(--plx-tint)", fontSize: "0.78rem", lineHeight: 1.55, color: "var(--plx-muted)" }}>
        <strong style={{ color: "var(--plx-text)" }}>Where it runs:</strong>{" "}
        {state?.domain ? `on every page of ${state.domain}` : "on every page of your own domain once one is connected"}
        {onCheckout ? "." : ", except cart, checkout and order pages."} Once per page, never inside the editor, and never on your free Plexo address. If your page already has the same code, add it in only one place so visits aren&apos;t counted twice.
        <br />
        Only paste code from a service you trust: it runs for every visitor to your site. We accept script, meta, link, noscript and style tags, and turn away anything that could redirect visitors or break the page.
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "0.9rem", marginTop: "0.9rem", flexWrap: "wrap" }}>
        <button type="button" onClick={save} disabled={locked || saving || !state || hasProblem} style={{ padding: "0.5rem 1.1rem", borderRadius: 8, border: "none", background: "var(--plx-brand)", color: "var(--plx-on-brand)", fontWeight: 700, fontSize: "0.82rem", cursor: locked || hasProblem ? "not-allowed" : "pointer", opacity: locked || hasProblem ? 0.5 : 1 }}>
          {saving ? "Saving…" : "Save code"}
        </button>
        {hasProblem && <span style={{ fontSize: "0.78rem", color: "var(--plx-danger)" }}>Fix the problem above to save.</span>}
        {message && <span role={message.kind === "error" ? "alert" : "status"} style={{ fontSize: "0.8rem", color: message.kind === "error" ? "var(--plx-danger)" : "var(--plx-success)" }}>{message.text}</span>}
        {state?.updatedAt && !message && <span style={{ fontSize: "0.75rem", color: "var(--plx-muted)" }}>Last changed {new Date(state.updatedAt).toLocaleString()}{state.updatedBy ? ` by ${state.updatedBy}` : ""}</span>}
      </div>
    </div>
  );
}
