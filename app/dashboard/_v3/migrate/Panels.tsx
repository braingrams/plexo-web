"use client";

import "./migrate.css";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Download, KeyRound, RefreshCw } from "lucide-react";
import { Badge, Button, ButtonLink, CardHeader, Card } from "../ui";
import { CopyBox } from "../settings/bits";
import { Disclosure, Note } from "./pieces";
import { checkPill } from "@/lib/wpMigration/moveView";
import type { ConnectorView, CutoverRecord, CutoverView, ExtrasView } from "@/app/dashboard/migrate/wordpress/WordPressMigrationClient";

function plexoRoleFor(roles: string[]): "admin" | "editor" | "blogger" {
  if (roles.includes("administrator")) return "admin";
  if (roles.some((r) => r === "author" || r === "contributor")) return "blogger";
  return "editor";
}

// The two working panels of a move, on the v3 look: copying what WordPress keeps private,
// and switching the domain. They call exactly the same endpoints as the classic panels.

// ── Private things ─────────────────────────────────────────────────────────────

export function PrivateDataPanel({ templateId, jobId, fixture }: { templateId: string; jobId: string; fixture?: { connector: ConnectorView | null; extras: ExtrasView | null } }) {
  const base = `/api/v1/wp-migration/${templateId}/${jobId}/connector`;
  const [connector, setConnector] = useState<ConnectorView | null>(fixture?.connector ?? null);
  const [extras, setExtras] = useState<ExtrasView | null>(fixture?.extras ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [invited, setInvited] = useState<Record<string, string>>({});

  useEffect(() => {
    if (fixture) return;
    void fetch(base).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!d) return;
      setConnector(d.connector);
      setExtras(d.extras);
    });
  }, [base, fixture]);

  async function start() {
    setBusy("start");
    const res = await fetch(base, { method: "POST" });
    if (res.ok) setConnector((await res.json()).connector);
    setBusy(null);
  }
  async function check() {
    setBusy("check");
    const res = await fetch(`${base}?check=1`);
    if (res.ok) setConnector((await res.json()).connector);
    setBusy(null);
  }
  async function importAll() {
    setBusy("import");
    for (let i = 0; i < 200; i++) {
      const res = await fetch(`${base}/import`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setExtras((prev) => ({ ...(prev ?? { stage: "error", counts: { formEntries: 0, records: 0, donations: 0, redirects: 0, drafts: 0, commentEmails: 0 }, team: [], unmoved: [] }), error: body.error ?? "Import stopped." }));
        break;
      }
      setExtras(body.extras);
      if (body.extras.stage === "done" || body.extras.error) break;
    }
    setBusy(null);
  }
  async function invite(person: { email: string; roles: string[] }) {
    setInvited((m) => ({ ...m, [person.email]: "sending" }));
    const role = plexoRoleFor(person.roles);
    const res = await fetch("/api/org/invite", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: person.email, role, scopedTemplateIds: role === "editor" ? [templateId] : [] }) });
    const body = await res.json().catch(() => ({}));
    setInvited((m) => ({ ...m, [person.email]: res.ok ? "sent" : body.error ?? "failed" }));
  }

  const s = connector?.summary;
  const found = s
    ? [
        s.forminator_forms.reduce((n, f) => n + f.entries, 0) > 0 ? `${s.forminator_forms.reduce((n, f) => n + f.entries, 0)} past form replies` : null,
        ...s.tables.filter((t) => t.rows > 0 && t.columns.some((c) => /e-?mail/i.test(c))).map((t) => `${t.rows} records in “${t.name}”`),
        s.payform?.paid ? `${s.payform.paid} past donations` : null,
        s.drafts ? `${s.drafts} drafts` : null,
        s.redirects ? `${s.redirects} redirect rules` : null,
        s.team ? `${s.team} team members` : null,
        s.givewp?.donations ? `${s.givewp.donations} past donations` : null,
        s.woocommerce?.orders ? `${s.woocommerce.orders} past shop orders` : null,
        s.woocommerce?.coupons ? `${s.woocommerce.coupons} coupons` : null,
        s.woocommerce?.shipping_zones ? `${s.woocommerce.shipping_zones} delivery areas` : null,
        s.woocommerce?.downloadable ? `${s.woocommerce.downloadable} downloadable products` : null,
        s.woocommerce?.products ? "exact stock levels" : null,
      ].filter(Boolean)
    : [];
  const done = extras?.stage === "done";
  const c = extras?.counts;

  return (
    <div className="plx-stack">
      <p className="plx-body" style={{ margin: 0 }}>
        Everything visitors see is already on Plexo. Some things only live inside WordPress: past form replies, donations, drafts, redirects and your team. A small helper you add to WordPress lets us copy those too. It only reads, and never changes your site.
      </p>

      {!connector ? (
        <div className="plx-row">
          <Button leftIcon={<KeyRound size={18} />} loading={busy === "start"} loadingLabel="Preparing" onClick={() => void start()}>Connect with a code</Button>
        </div>
      ) : null}

      {connector && connector.status !== "CONNECTED" ? (
        <ol className="plx-howto">
          <li><div className="plx-howto__body"><b>Get the helper</b><span>Download it, then in WordPress go to <b>Plugins → Add New → Upload Plugin</b>, choose the file and press <b>Activate</b>.</span><div><ButtonLink variant="secondary" size="sm" href="/api/v1/wp-migration/plugin" leftIcon={<Download size={16} />}>Download the helper</ButtonLink></div></div></li>
          <li><div className="plx-howto__body"><b>Paste your code</b><span>In WordPress open <b>Tools → Plexo Migrator</b> and paste this code.</span><CopyBox value={connector.code ?? ""} label="Connection code" /></div></li>
          <li><div className="plx-howto__body"><b>Tell us you've done it</b><div><Button loading={busy === "check"} loadingLabel="Checking" onClick={() => void check()} leftIcon={<RefreshCw size={16} />}>Check the connection</Button></div>{connector.error ? <Note tone="warning">{connector.error}</Note> : null}</div></li>
        </ol>
      ) : null}

      {connector?.status === "CONNECTED" && !done ? (
        <div className="plx-stack">
          <Note tone="good" title="Connected to your WordPress site">{found.length ? `We found ${found.join(", ")}.` : "There's nothing private to copy. You're all set."}</Note>
          {found.length > 0 ? <div><Button loading={busy === "import"} loadingLabel={`Copying… ${c ? Object.values(c).reduce((a, b) => a + b, 0) : 0} so far`} onClick={() => void importAll()}>Copy it all to Plexo</Button></div> : null}
          {extras?.error ? <Note tone="bad">{extras.error} Press the button again to carry on where it stopped.</Note> : null}
        </div>
      ) : null}

      {done && extras && c ? (
        <div className="plx-stack">
          <Note tone="good" title="Copied to Plexo">
            {[
              c.formEntries && `${c.formEntries} form replies`, c.records && `${c.records} sign-up records`, c.donations && `${c.donations} past donations`, c.drafts && `${c.drafts} drafts`,
              c.redirects && `${c.redirects} redirects`, c.commentEmails && `${c.commentEmails} commenter emails`, c.orders && `${c.orders} past shop orders`, c.coupons && `${c.coupons} coupons`,
              c.deliveryMethods && `${c.deliveryMethods} delivery options`, c.digitalProducts && `${c.digitalProducts} downloads`, c.stockUpdated && `exact stock for ${c.stockUpdated} products`,
            ].filter(Boolean).join(", ") || "everything"}.
          </Note>
          {extras.storeNotes && extras.storeNotes.length > 0 ? <div><b>Worth a look in your shop</b><ul className="plx-small" style={{ margin: "6px 0 0", paddingLeft: 18 }}>{extras.storeNotes.map((x) => <li key={x}>{x}</li>)}</ul></div> : null}
          {extras.formNotes && extras.formNotes.length > 0 ? (
            <div className="plx-stack" style={{ gap: 8 }}>
              <b>Your forms</b>
              <ul className="plx-small" style={{ margin: 0, paddingLeft: 18 }}>{extras.formNotes.map((x) => <li key={`${x.form}:${x.note}`}><b>{x.form}:</b> {x.note}</li>)}</ul>
              <div><ButtonLink size="sm" variant="secondary" href={`/dashboard/templates/${templateId}/form-submissions`}>Choose where replies go</ButtonLink></div>
            </div>
          ) : null}
          {extras.redirectPatterns && extras.redirectPatterns.length > 0 ? (
            <div className="plx-stack" style={{ gap: 8 }}>
              <b>Redirects to add yourself</b>
              <p className="plx-small" style={{ margin: 0 }}>These cover many addresses at once. Plexo redirects one address at a time, so add the ones you still need in your site's redirect settings. Every single-address rule was copied already.</p>
              <ul className="plx-small" style={{ margin: 0, paddingLeft: 18 }}>{extras.redirectPatterns.map((r) => <li key={`${r.from}→${r.to}`}><code>{r.from}</code> → <code>{r.to}</code></li>)}</ul>
            </div>
          ) : null}
          {extras.team.length > 0 ? (
            <div className="plx-stack" style={{ gap: 4 }}>
              <b>Invite your team to Plexo</b>
              <div className="plx-facts">
                {extras.team.map((t) => (
                  <div className="plx-fact" key={t.email} style={{ alignItems: "center", flexWrap: "wrap" }}>
                    <div className="plx-fact__text"><b>{t.name}</b><span>{t.email} · {plexoRoleFor(t.roles) === "editor" ? "Editor (this site)" : plexoRoleFor(t.roles) === "admin" ? "Admin" : "Blogger"}</span></div>
                    {invited[t.email] === "sent" ? <Badge tone="success">Invited</Badge> : <Button size="sm" variant="secondary" loading={invited[t.email] === "sending"} onClick={() => void invite(t)}>Invite</Button>}
                    {invited[t.email] && !["sent", "sending"].includes(invited[t.email]) ? <span className="plx-field__error">{invited[t.email]}</span> : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {extras.unmoved.length > 0 ? <p className="plx-small" style={{ margin: 0 }}>Left behind on WordPress (settings and internal data, not visitor replies): {extras.unmoved.map((u) => `${u.table} (${u.rows})`).join(", ")}.</p> : null}
        </div>
      ) : null}
    </div>
  );
}

// ── Switch the domain ──────────────────────────────────────────────────────────

function Records({ records }: { records: CutoverRecord[] }) {
  return (
    <div className="plx-recs">
      <table>
        <thead><tr><th>Type</th><th>Name</th><th>Value</th><th>What it does</th></tr></thead>
        <tbody>
          {records.map((r, i) => (
            <tr key={i}><td><b>{r.type}</b></td><td><code>{r.name}</code></td><td><code>{r.priority !== undefined ? `${r.priority} ` : ""}{r.value}</code></td><td>{r.why}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DomainPanel({ templateId, jobId, fixture, onSafe }: { templateId: string; jobId: string; fixture?: CutoverView; onSafe?: (safe: boolean) => void }) {
  const base = `/api/v1/wp-migration/${templateId}/${jobId}/cutover`;
  const [view, setView] = useState<CutoverView | null>(fixture ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (fixture) return;
    const res = await fetch(base);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) setError(body.error ?? "We couldn't read your domain's settings. Please try again.");
    else setView(body);
  }, [base, fixture]);
  useEffect(() => { void load(); }, [load]);
  const safe = view?.verification?.safeToCancelWordPress ?? false;
  useEffect(() => { onSafe?.(safe); }, [safe, onSafe]);

  async function connect() {
    if (!view) return;
    setBusy("connect");
    setError(null);
    for (const domain of [view.plan.domain, view.plan.wwwDomain]) {
      if (view.connected.some((c) => c.domain === domain)) continue;
      const res = await fetch("/api/v1/domains", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ templateId, type: "CUSTOM", domain }) });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `We couldn't connect ${domain}.`);
        break;
      }
    }
    await load();
    setBusy(null);
  }
  async function verify() {
    setBusy("verify");
    const res = await fetch(`${base}/verify`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (res.ok && view) setView({ ...view, verification: body.verification });
    else setError(body.error ?? "We couldn't check your domain. Please try again.");
    setBusy(null);
  }
  function downloadZone() {
    if (!view) return;
    const url = URL.createObjectURL(new Blob([view.plan.zoneFile], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${view.plan.domain}.zone.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!view) return <Card padding="lg"><p className="plx-body" style={{ margin: 0 }}>{error ?? "Looking at your domain's current settings…"}</p></Card>;
  const { plan } = view;
  const bothConnected = [plan.domain, plan.wwwDomain].every((d) => view.connected.some((c) => c.domain === d));
  const v = view.verification;
  const company = plan.dnsHost.name !== "unknown" ? plan.dnsHost.name : "the company you bought your domain from";

  return (
    <div className="plx-stack">
      {plan.warnings.map((w) => <Note key={w} tone={/stop|deleted|shut/i.test(w) ? "warning" : "info"}>{w}</Note>)}

      <Card padding="lg">
        <CardHeader title="Three steps to go live" description="Take your time. Nothing changes for your visitors until step 2 is done." />
        <ol className="plx-howto">
          <li>
            <div className="plx-howto__body">
              <b>Tell Plexo your domain</b>
              <span>This tells us to answer when someone visits <b>{plan.domain}</b>.</span>
              {bothConnected ? (
                <div className="plx-row">
                  {view.connected.map((c) => <Badge key={c.domain} tone={c.ready ? "success" : "neutral"} dot>{c.domain}: {c.ready ? "ready" : "waiting for step 2"}</Badge>)}
                </div>
              ) : <div><Button loading={busy === "connect"} loadingLabel="Connecting" onClick={() => void connect()}>Connect {plan.domain}</Button></div>}
            </div>
          </li>
          <li>
            <div className="plx-howto__body">
              <b>Make one change at {company}</b>
              {bothConnected ? (
                <>
                  <span>Sign in where you manage your domain, find its address settings (often called DNS), and follow these:</span>
                  <ol className="plx-stack" style={{ margin: 0, paddingLeft: 20, gap: 8 }}>{plan.steps.map((step) => <li key={step}>{step}</li>)}</ol>
                  <Disclosure title="Show the exact settings to type in" hint="You can copy these straight across">
                    <b>Add these</b>
                    <Records records={plan.plexo} />
                    {!plan.plexo.some((r) => /certificate/i.test(r.why)) ? <p className="plx-small" style={{ margin: 0 }}>One more line appears here a few seconds after connecting. Refresh if it's missing.</p> : null}
                    {plan.keep.length > 0 ? (<><b>Leave these exactly as they are{plan.email ? ` (your ${plan.email.provider} email needs them)` : ""}</b><Records records={plan.keep} /></>) : null}
                    <div className="plx-row">
                      <Button size="sm" variant="secondary" leftIcon={<Download size={16} />} onClick={downloadZone}>Download as a file</Button>
                      <Button size="sm" variant="secondary" leftIcon={<RefreshCw size={16} />} onClick={() => void load()}>Refresh</Button>
                    </div>
                  </Disclosure>
                </>
              ) : <span>This shows up once step 1 is done.</span>}
            </div>
          </li>
          <li>
            <div className="plx-howto__body">
              <b>Check it worked</b>
              <span>It can take a few minutes, sometimes a few hours, to spread. Check as often as you like.</span>
              {bothConnected ? <div><Button loading={busy === "verify"} loadingLabel="Checking every page" onClick={() => void verify()} leftIcon={<CheckCircle2 size={18} />}>Check my domain</Button></div> : null}
            </div>
          </li>
        </ol>
      </Card>

      {v ? (
        <Card padding="lg">
          <CardHeader title="What we found" description={`${v.pages.ok} of ${v.pages.total} pages open correctly on your domain.`} />
          <div className="plx-facts">
            {v.checks.map((c) => {
              const pill = checkPill(c.status);
              return (
                <div className="plx-fact" key={c.id}>
                  <div className="plx-fact__text"><b>{c.label}</b><span>{c.detail}</span></div>
                  <Badge tone={pill.tone === "danger" ? "danger" : pill.tone} dot>{pill.label}</Badge>
                </div>
              );
            })}
          </div>
          {!v.safeToCancelWordPress ? <div style={{ marginTop: 16 }}><Note tone="info" title="Not yet. Keep WordPress running for now.">Finish the items above and check again. Nothing is lost by waiting, and visitors are served the whole time.</Note></div> : null}
        </Card>
      ) : null}
      {error ? <Note tone="bad">{error}</Note> : null}
      <Link href="/dashboard/settings/domains" className="plx-small" style={{ alignSelf: "flex-start" }}>Manage all your web addresses</Link>
    </div>
  );
}

