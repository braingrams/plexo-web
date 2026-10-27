"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { CheckStep, FindSiteStep, GoLiveStep, MovingStep, PluginList, ReviewStep } from "./wizard/steps";
import { Stepper, type WizardStep } from "./wizard/ui";
import type { DomainRow, ExistingMigration, JobStatus, Preview, Report } from "./wizard/types";

// "Move from WordPress", as a guided wizard (./wizard): find the site → review what will
// move → watch it move → check the new site → go live. One thing per screen, one obvious
// button, the details tucked away until someone asks for them. This file owns the data —
// checking the site, starting the move, watching it, publishing a preview — and the two
// working panels (bringing over private data, switching the domain); ./wizard/steps.tsx
// draws each screen.

const hairline = "var(--surface-border)";

/** How often the screen checks on a running migration. */
const WATCH_EVERY_MS = 4000;
/** A step takes under a minute; no sign of the server for longer than this means its chain broke. */
const QUIET_RESTART_MS = 90_000;

function slugify(input: string): string {
  return input.toLowerCase().replace(/^https?:\/\//, "").replace(/\.[a-z]+$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

function mb(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

const card: React.CSSProperties = { borderRadius: 16, border: `1px solid ${hairline}`, background: "var(--surface)", padding: 24, boxShadow: "var(--shadow-card)" };
const muted: React.CSSProperties = { fontSize: "13.5px", color: "var(--text-muted)", lineHeight: 1.6, margin: 0 };
const inputStyle: React.CSSProperties = {
  flex: 1, minWidth: 0, background: "rgba(var(--brand-rgb),0.03)", border: `1px solid ${hairline}`, borderRadius: 12,
  color: "var(--text-main)", padding: "11px 14px", fontSize: "14px", outline: "none", fontFamily: "inherit",
};

function primaryButton(enabled: boolean): React.CSSProperties {
  return {
    fontSize: "14px", fontWeight: 650, color: "#fff", background: enabled ? "linear-gradient(135deg, var(--brand), var(--brand-deeper))" : "var(--text-faint)",
    padding: "11px 20px", borderRadius: 12, border: "none", cursor: enabled ? "pointer" : "not-allowed", whiteSpace: "nowrap", fontFamily: "inherit",
    boxShadow: enabled ? "0 6px 18px rgba(var(--brand-rgb),0.25)" : "none", opacity: enabled ? 1 : 0.6,
  };
}
const secondaryButton: React.CSSProperties = {
  fontSize: "13.5px", fontWeight: 600, color: "var(--text-main)", background: "transparent", padding: "10px 16px",
  borderRadius: 12, border: `1px solid ${hairline}`, cursor: "pointer", whiteSpace: "nowrap", fontFamily: "inherit", textDecoration: "none", display: "inline-block",
};

type CheckStatus = "done" | "blocked" | "review" | "todo";
/** A numbered heading for each of the domain switch's three steps. */
function NumberedTitle({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <p style={{ margin: 0, display: "flex", alignItems: "center", gap: 10, fontSize: "15px", fontWeight: 700, color: "var(--text-main)" }}>
      <span style={{ width: 26, height: 26, borderRadius: 999, display: "grid", placeItems: "center", fontSize: 13, background: "rgba(var(--brand-rgb),0.12)", color: "var(--brand)", flexShrink: 0 }}>{n}</span>
      {children}
    </p>
  );
}

function StatusDot({ status }: { status: CheckStatus }) {
  const map = { done: ["#34d399", "✓"], blocked: ["#f87171", "!"], review: ["#f5b74a", "?"], todo: ["var(--text-faint)", "○"] } as const;
  const [color, glyph] = map[status];
  return (
    <span style={{ width: 22, height: 22, borderRadius: 999, border: `1.5px solid ${color}`, color, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, flexShrink: 0 }}>
      {glyph}
    </span>
  );
}

interface ConnectorView {
  status: "WAITING" | "CONNECTED" | "ERROR";
  summary: {
    tables: { name: string; rows: number; columns: string[] }[];
    forminator_forms: { id: number; title: string; entries: number }[];
    payform: { paid: number } | null;
    drafts: number;
    redirects: number;
    team: number;
    woocommerce?: { products: number; downloadable: number; coupons: number; orders: number; shipping_zones: number } | null;
    givewp?: { forms: number; donations: number } | null;
  } | null;
  error: string | null;
  code: string | null;
}
interface ExtrasView {
  stage: string;
  counts: {
    formEntries: number;
    records: number;
    donations: number;
    redirects: number;
    drafts: number;
    commentEmails: number;
    stockUpdated?: number;
    digitalProducts?: number;
    coupons?: number;
    deliveryMethods?: number;
    orders?: number;
    formActions?: number;
  };
  storeNotes?: string[];
  redirectPatterns?: { from: string; to: string; kind: string; plugin: string }[];
  formNotes?: { form: string; note: string }[];
  team: { name: string; email: string; roles: string[] }[];
  unmoved: { table: string; rows: number }[];
  error?: string;
}

function plexoRoleFor(roles: string[]): "admin" | "editor" | "blogger" {
  if (roles.includes("administrator")) return "admin";
  if (roles.some((r) => r === "author" || r === "contributor")) return "blogger";
  return "editor";
}

/**
 * "Copy what WordPress keeps private" — past form entries, records custom plugins keep,
 * donation history, drafts, redirects and the team, via the Plexo Migrator plugin.
 */
function PrivateDataCard({ templateId, jobId }: { templateId: string; jobId: string }) {
  const base = `/api/v1/wp-migration/${templateId}/${jobId}/connector`;
  const [connector, setConnector] = useState<ConnectorView | null>(null);
  const [extras, setExtras] = useState<ExtrasView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [invited, setInvited] = useState<Record<string, string>>({});

  useEffect(() => {
    void fetch(base).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!d) return;
      setConnector(d.connector);
      setExtras(d.extras);
    });
  }, [base]);

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
    const res = await fetch("/api/org/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: person.email, role, scopedTemplateIds: role === "editor" ? [templateId] : [] }),
    });
    const body = await res.json().catch(() => ({}));
    setInvited((m) => ({ ...m, [person.email]: res.ok ? "sent" : body.error ?? "failed" }));
  }

  const s = connector?.summary;
  const found = s
    ? [
        s.forminator_forms.reduce((n, f) => n + f.entries, 0) > 0 ? `${s.forminator_forms.reduce((n, f) => n + f.entries, 0)} past form entries` : null,
        ...s.tables.filter((t) => t.rows > 0 && t.columns.some((c) => /e-?mail/i.test(c))).map((t) => `${t.rows} records in “${t.name}”`),
        s.payform?.paid ? `${s.payform.paid} past donations` : null,
        s.drafts ? `${s.drafts} drafts` : null,
        s.redirects ? `${s.redirects} redirect rules` : null,
        s.team ? `${s.team} team members` : null,
        s.givewp?.donations ? `${s.givewp.donations} past GiveWP donations` : null,
        s.woocommerce?.orders ? `${s.woocommerce.orders} past shop orders` : null,
        s.woocommerce?.coupons ? `${s.woocommerce.coupons} coupons` : null,
        s.woocommerce?.shipping_zones ? `${s.woocommerce.shipping_zones} shipping zones` : null,
        s.woocommerce?.downloadable ? `${s.woocommerce.downloadable} downloadable products` : null,
        s.woocommerce?.products ? "exact stock levels" : null,
      ].filter(Boolean)
    : [];
  const done = extras?.stage === "done";

  return (
    <div>
      <p style={{ ...muted, marginBottom: 14 }}>
        Everything visitors see is already on Plexo. A small, read-only WordPress plugin lets Plexo also copy what only lives inside WordPress:
        past form entries and applications, donation history, drafts, redirect rules and your team. It never changes your WordPress site.
      </p>

      {!connector && (
        <button type="button" style={primaryButton(busy !== "start")} disabled={busy === "start"} onClick={() => void start()}>
          {busy === "start" ? "Preparing…" : "Get the plugin and a connection code"}
        </button>
      )}

      {connector && connector.status !== "CONNECTED" && (
        <ol style={{ ...muted, fontSize: "13.5px", paddingLeft: 18, display: "flex", flexDirection: "column", gap: 10, margin: 0 }}>
          <li>
            <a href="/api/v1/wp-migration/plugin" style={{ color: "var(--brand)", fontWeight: 650 }}>Download the Plexo Migrator plugin</a>, then in WordPress go to <strong>Plugins → Add New → Upload Plugin</strong>, upload it and click <strong>Activate</strong>.
          </li>
          <li>
            In WordPress go to <strong>Tools → Plexo Migrator</strong> and paste this code:
            <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
              <code style={{ ...inputStyle, flex: "1 1 260px", fontSize: "13px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{connector.code}</code>
              <button type="button" style={secondaryButton} onClick={() => { void navigator.clipboard.writeText(connector.code ?? ""); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
                {copied ? "Copied ✓" : "Copy"}
              </button>
            </div>
          </li>
          <li>
            <button type="button" style={primaryButton(busy !== "check")} disabled={busy === "check"} onClick={() => void check()}>
              {busy === "check" ? "Checking…" : "Check connection"}
            </button>
            {connector.error && <p style={{ ...muted, color: "#f5b74a", marginTop: 8 }}>{connector.error}</p>}
          </li>
        </ol>
      )}

      {connector?.status === "CONNECTED" && !done && (
        <div>
          <p style={{ ...muted, color: "#6ee7a8", fontWeight: 650 }}>Connected to your WordPress site.</p>
          <p style={{ ...muted, marginBottom: 10 }}>{found.length ? `Found ${found.join(", ")}.` : "Nothing private to copy was found — you're all set."}</p>
          {found.length > 0 && (
            <button type="button" style={primaryButton(busy !== "import")} disabled={busy === "import"} onClick={() => void importAll()}>
              {busy === "import" ? `Copying… ${extras ? Object.values(extras.counts).reduce((a, b) => a + b, 0) : 0} items so far` : "Copy it all to Plexo"}
            </button>
          )}
          {extras?.error && <p style={{ ...muted, color: "#f87171", marginTop: 8 }}>{extras.error} — click again to continue where it stopped.</p>}
        </div>
      )}

      {done && extras && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p style={{ ...muted, color: "#f0f2ff" }}>
            Copied {[
              extras.counts.formEntries && `${extras.counts.formEntries} form entries`,
              extras.counts.records && `${extras.counts.records} application/sign-up records`,
              extras.counts.donations && `${extras.counts.donations} past donations`,
              extras.counts.drafts && `${extras.counts.drafts} drafts`,
              extras.counts.redirects && `${extras.counts.redirects} redirects`,
              extras.counts.commentEmails && `${extras.counts.commentEmails} commenter emails`,
              extras.counts.orders && `${extras.counts.orders} past shop orders`,
              extras.counts.coupons && `${extras.counts.coupons} coupons`,
              extras.counts.deliveryMethods && `${extras.counts.deliveryMethods} delivery options`,
              extras.counts.digitalProducts && `${extras.counts.digitalProducts} downloads`,
              extras.counts.stockUpdated && `exact stock for ${extras.counts.stockUpdated} products`,
              extras.counts.formActions && `what ${extras.counts.formActions} form${extras.counts.formActions === 1 ? "" : "s"} did after a submission (webhooks, thank-you pages, mailing lists)`,
            ].filter(Boolean).join(", ") || "everything"}. Form history is in Form Submissions; donations, orders, coupons and delivery are in Commerce.
          </p>
          {extras.storeNotes && extras.storeNotes.length > 0 && (
            <div>
              <p style={{ ...muted, fontWeight: 650, color: "#f0f2ff", marginBottom: 6 }}>Worth a look in your shop</p>
              <ul style={{ ...muted, margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
                {extras.storeNotes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </div>
          )}
          {extras.formNotes && extras.formNotes.length > 0 && (
            <div>
              <p style={{ ...muted, fontWeight: 650, color: "#f0f2ff", marginBottom: 6 }}>Your forms</p>
              <ul style={{ ...muted, margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
                {extras.formNotes.map((n) => (
                  <li key={`${n.form}:${n.note}`}><strong style={{ color: "#f0f2ff" }}>{n.form}:</strong> {n.note}</li>
                ))}
              </ul>
              <Link href={`/dashboard/templates/${templateId}/form-submissions`} style={{ ...secondaryButton, marginTop: 8, display: "inline-block" }}>Set up where submissions go →</Link>
            </div>
          )}
          {extras.redirectPatterns && extras.redirectPatterns.length > 0 && (
            <div>
              <p style={{ ...muted, fontWeight: 650, color: "#f0f2ff", marginBottom: 6 }}>Redirect rules to add yourself</p>
              <p style={{ ...muted, marginBottom: 6 }}>
                These match many addresses at once (wildcards or patterns). Plexo redirects exact addresses, so add the ones you still need in your site&rsquo;s Redirects settings — every exact rule was copied already.
              </p>
              <ul style={{ ...muted, margin: 0, paddingLeft: 18, fontSize: "13.5px" }}>
                {extras.redirectPatterns.map((r) => (
                  <li key={`${r.from}→${r.to}`}><code>{r.from}</code> → <code>{r.to}</code> <span style={{ opacity: 0.7 }}>({r.plugin}, {r.kind})</span></li>
                ))}
              </ul>
            </div>
          )}
          {extras.team.length > 0 && (
            <div>
              <p style={{ ...muted, fontWeight: 650, color: "#f0f2ff", marginBottom: 6 }}>Invite your team to Plexo</p>
              {extras.team.map((t) => (
                <div key={t.email} style={{ display: "flex", gap: 10, alignItems: "center", padding: "6px 0", borderTop: `1px solid ${hairline}`, flexWrap: "wrap" }}>
                  <span style={{ flex: "1 1 220px", fontSize: "13.5px" }}>{t.name} <span style={muted}>{t.email}</span></span>
                  <span style={{ ...muted, fontSize: "13.5px", minWidth: 120 }}>{plexoRoleFor(t.roles) === "editor" ? "Editor (this site)" : plexoRoleFor(t.roles) === "admin" ? "Admin" : "Blogger"}</span>
                  {invited[t.email] === "sent" ? (
                    <span style={{ fontSize: "13px", color: "#6ee7a8", fontWeight: 650 }}>Invited ✓</span>
                  ) : (
                    <button type="button" style={{ ...secondaryButton, padding: "5px 12px" }} disabled={invited[t.email] === "sending"} onClick={() => void invite(t)}>
                      {invited[t.email] === "sending" ? "Sending…" : "Invite"}
                    </button>
                  )}
                  {invited[t.email] && !["sent", "sending"].includes(invited[t.email]) && <span style={{ ...muted, color: "#f87171", fontSize: "13.5px" }}>{invited[t.email]}</span>}
                </div>
              ))}
            </div>
          )}
          {extras.unmoved.length > 0 && (
            <p style={{ ...muted, fontSize: "13.5px" }}>
              Left on WordPress (plugin settings and internal data, not visitor submissions): {extras.unmoved.map((u) => `${u.table} (${u.rows})`).join(", ")}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}


interface CutoverRecord { name: string; type: string; value: string; priority?: number; why: string }
interface CutoverView {
  plan: {
    domain: string;
    wwwDomain: string;
    dnsHost: { name: string; tiedToWebHost: boolean; apexHostnameSupport: string; apexRecordType: string };
    email: { provider: string; onWebHost: boolean } | null;
    keep: CutoverRecord[];
    plexo: CutoverRecord[];
    zoneFile: string;
    steps: string[];
    warnings: string[];
  };
  connected: { domain: string; ready: boolean }[];
  verification: {
    checks: { id: string; label: string; status: "done" | "blocked" | "todo" | "review"; detail: string }[];
    pages: { ok: number; total: number };
    safeToCancelWordPress: boolean;
    checkedAt: string;
  } | null;
}

function RecordTable({ records }: { records: CutoverRecord[] }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
        <thead>
          <tr style={{ textAlign: "left", color: "var(--text-muted)" }}>
            <th style={{ padding: "4px 8px 4px 0" }}>Type</th><th style={{ padding: "4px 8px" }}>Name</th><th style={{ padding: "4px 8px" }}>Value</th><th style={{ padding: "4px 0 4px 8px" }}>What it does</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r, i) => (
            <tr key={i} style={{ borderTop: `1px solid ${hairline}`, verticalAlign: "top" }}>
              <td style={{ padding: "6px 8px 6px 0", fontWeight: 650 }}>{r.type}</td>
              <td style={{ padding: "6px 8px" }}><code>{r.name}</code></td>
              <td style={{ padding: "6px 8px", wordBreak: "break-all", maxWidth: 340 }}><code>{r.priority !== undefined ? `${r.priority} ` : ""}{r.value}</code></td>
              <td style={{ padding: "6px 0 6px 8px", color: "var(--text-muted)" }}>{r.why}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** "Switch your domain" — connect, the exact DNS changes (keeping email safe), then a live check of every URL. */
function CutoverPanel({ templateId, jobId }: { templateId: string; jobId: string }) {
  const base = `/api/v1/wp-migration/${templateId}/${jobId}/cutover`;
  const [view, setView] = useState<CutoverView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(base);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) setError(body.error ?? "Couldn't read your domain's settings.");
    else setView(body);
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  async function connect() {
    if (!view) return;
    setBusy("connect");
    setError(null);
    for (const domain of [view.plan.domain, view.plan.wwwDomain]) {
      if (view.connected.some((c) => c.domain === domain)) continue;
      const res = await fetch("/api/v1/domains", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ templateId, type: "CUSTOM", domain }) });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Couldn't connect ${domain}.`);
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
    else setError(body.error ?? "Couldn't check your domain.");
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

  if (!view) return <div style={card}><p style={muted}>{error ?? "Reading your domain's current settings…"}</p></div>;
  const { plan } = view;
  const bothConnected = [plan.domain, plan.wwwDomain].every((d) => view.connected.some((c) => c.domain === d));
  const v = view.verification;

  return (
    <div style={{ ...card, display: "flex", flexDirection: "column", gap: 20 }}>

      {plan.warnings.map((w) => (
        <div key={w} style={{ padding: "10px 12px", borderRadius: 9, border: `1px solid ${/stop|deleted|shut/i.test(w) ? "rgba(245,183,74,0.45)" : hairline}`, background: /stop|deleted|shut/i.test(w) ? "rgba(245,183,74,0.07)" : "transparent" }}>
          <p style={{ ...muted, color: "var(--text-main)", fontSize: "13.5px" }}>{w}</p>
        </div>
      ))}

      <div>
        <NumberedTitle n={1}>Tell Plexo about your domain</NumberedTitle>
        <div style={{ height: 8 }} />
        {bothConnected ? (
          <p style={{ ...muted, fontSize: "13px" }}>{view.connected.map((c) => `${c.domain} — ${c.ready ? "certificate ready" : "waiting for DNS"}`).join(" · ")}</p>
        ) : (
          <button type="button" style={primaryButton(busy !== "connect")} disabled={busy === "connect"} onClick={() => void connect()}>
            {busy === "connect" ? "Connecting…" : `Connect ${plan.domain} and ${plan.wwwDomain}`}
          </button>
        )}
      </div>

      {bothConnected && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <NumberedTitle n={2}>Update your domain&rsquo;s settings{plan.dnsHost.name !== "unknown" ? ` at ${plan.dnsHost.name}` : ""}</NumberedTitle>
          <ol style={{ ...muted, fontSize: "13.5px", paddingLeft: 18, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            {plan.steps.map((step) => <li key={step}>{step}</li>)}
          </ol>
          <div>
            <p style={{ ...muted, fontWeight: 650, color: "var(--text-main)", marginBottom: 4 }}>Add these (Plexo)</p>
            <RecordTable records={plan.plexo} />
            {!plan.plexo.some((r) => /certificate/i.test(r.why)) && <p style={{ ...muted, fontSize: "13.5px", marginTop: 4 }}>The certificate record appears here a few seconds after connecting — refresh if it's missing.</p>}
          </div>
          {plan.keep.length > 0 && (
            <div>
              <p style={{ ...muted, fontWeight: 650, color: "var(--text-main)", marginBottom: 4 }}>Keep exactly as they are{plan.email ? ` (your ${plan.email.provider} email depends on these)` : ""}</p>
              <RecordTable records={plan.keep} />
            </div>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" style={secondaryButton} onClick={downloadZone}>Download zone file (for Cloudflare import)</button>
            <button type="button" style={secondaryButton} onClick={() => void load()}>Refresh</button>
          </div>
        </div>
      )}

      {bothConnected && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <NumberedTitle n={3}>Check it&rsquo;s live — then you can cancel WordPress</NumberedTitle>
          <div>
            <button type="button" style={primaryButton(busy !== "verify")} disabled={busy === "verify"} onClick={() => void verify()}>
              {busy === "verify" ? "Checking every page on your domain…" : "Check my domain"}
            </button>
          </div>
          {v && (
            <>
              {v.checks.map((c) => (
                <div key={c.id} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <StatusDot status={c.status} />
                  <div>
                    <div style={{ fontSize: "13.5px", fontWeight: 650 }}>{c.label}</div>
                    <p style={{ ...muted, fontSize: "13px" }}>{c.detail}</p>
                  </div>
                </div>
              ))}
              <div style={{ padding: "12px 14px", borderRadius: 10, background: v.safeToCancelWordPress ? "rgba(110,231,168,0.08)" : "rgba(255,255,255,0.03)", border: `1px solid ${v.safeToCancelWordPress ? "rgba(110,231,168,0.35)" : hairline}` }}>
                <p style={{ margin: 0, fontSize: "13px", fontWeight: 700 }}>
                  {v.safeToCancelWordPress ? "It's safe to cancel your WordPress hosting." : "Not yet — keep WordPress running for now."}
                </p>
                <p style={{ ...muted, fontSize: "13px", marginTop: 4 }}>
                  {v.safeToCancelWordPress
                    ? "Every page is served by Plexo on your domain, email is intact and your DNS no longer depends on the old host. Keep a backup of your WordPress files if your host offers one, then cancel."
                    : "Finish the items above and check again. Nothing is lost by waiting — visitors are being served the whole time."}
                </p>
              </div>
            </>
          )}
        </div>
      )}
      {error && <p style={{ ...muted, color: "#f87171" }}>{error}</p>}
    </div>
  );
}

export function WordPressMigrationClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [url, setUrl] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [upgradeNeeded, setUpgradeNeeded] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [owns, setOwns] = useState(false);
  const [needsAup, setNeedsAup] = useState(false);
  const [aup, setAup] = useState(false);
  const [starting, setStarting] = useState(false);
  const [job, setJob] = useState<JobStatus | null>(null);
  const [domains, setDomains] = useState<DomainRow[]>([]);
  const [existing, setExisting] = useState<ExistingMigration | null>(null);
  const [subdomain, setSubdomain] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  /** After the move: checking the new site, or going live. */
  const [afterView, setAfterView] = useState<"check" | "live" | null>(null);
  const loopRef = useRef(false);

  const jobId = searchParams.get("job");
  const siteId = searchParams.get("site");

  const refresh = useCallback(async (templateId: string, id: string): Promise<JobStatus | null> => {
    const res = await fetch(`/api/v1/wp-migration/${templateId}/${id}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { job: JobStatus; domains: DomainRow[] };
    setJob(data.job);
    setDomains(data.domains);
    return data.job;
  }, []);

  // The server runs the migration in the background (it hands each step to the next by
  // itself); this screen only watches. It used to drive the steps from the browser and hand
  // over when the tab closed — but a browser freezes a tab left in the background without
  // ever saying it's closing, so the migration sat idle until the 10-minute check found it.
  // If the server ever goes quiet for longer than a step can take, the screen restarts it.
  const runLoop = useCallback(
    async (templateId: string, id: string) => {
      if (loopRef.current) return;
      loopRef.current = true;
      let lastKick = 0;
      const kick = async () => {
        lastKick = Date.now();
        await fetch(`/api/v1/wp-migration/${templateId}/${id}/step?handoff=1`, { method: "POST" }).catch(() => {});
      };
      try {
        await kick();
        let misses = 0;
        for (;;) {
          await new Promise((r) => setTimeout(r, WATCH_EVERY_MS));
          const current = await refresh(templateId, id).catch(() => null);
          if (!current) {
            if (++misses >= 5) break; // gone, or we're offline — reopening the page picks it back up
            continue;
          }
          misses = 0;
          if (["COMPLETED", "FAILED", "CANCELLED", "PAUSED_ERROR"].includes(current.phase)) break;
          const lastBeat = current.lastHeartbeatAt ? Date.parse(current.lastHeartbeatAt) : 0;
          if (Date.now() - lastBeat > QUIET_RESTART_MS && Date.now() - lastKick > QUIET_RESTART_MS) await kick();
        }
      } finally {
        loopRef.current = false;
      }
    },
    [refresh],
  );

  // "Try again" on a paused migration: run the step that paused right here (so the result
  // shows straight away), then go back to watching the server carry on.
  const retry = useCallback(
    async (templateId: string, id: string) => {
      await fetch(`/api/v1/wp-migration/${templateId}/${id}/step`, { method: "POST" }).catch(() => {});
      const current = await refresh(templateId, id).catch(() => null);
      if (current && !["COMPLETED", "FAILED", "CANCELLED", "PAUSED_ERROR"].includes(current.phase)) void runLoop(templateId, id);
    },
    [refresh, runLoop],
  );

  useEffect(() => {
    if (jobId && siteId) {
      void refresh(siteId, jobId).then((j) => {
        if (j && !["COMPLETED", "FAILED", "CANCELLED", "PAUSED_ERROR"].includes(j.phase)) void runLoop(siteId, jobId);
      });
      return;
    }
    // Picking back up where they left off beats silently starting over.
    void fetch("/api/v1/wp-migration")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { migrations: ExistingMigration[] } | null) => {
        const active = data?.migrations.find((m) => !["COMPLETED", "FAILED", "CANCELLED"].includes(m.phase));
        if (active) setExisting(active);
      })
      .catch(() => {});
  }, [jobId, siteId, refresh, runLoop]);

  useEffect(() => {
    if (job?.report && !subdomain) setSubdomain(slugify(job.report.source.siteName || job.report.source.origin));
  }, [job, subdomain]);

  async function handleCheck(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setChecking(true);
    setError(null);
    setPreview(null);
    setUpgradeNeeded(false);
    try {
      const res = await fetch("/api/v1/wp-migration/detect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceUrl: url.trim() }) });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong — try again.");
        setUpgradeNeeded(Boolean(data.requiresUpgrade));
        return;
      }
      setPreview(data.preview as Preview);
    } catch {
      setError("We couldn't reach Plexo — check your connection and try again.");
    } finally {
      setChecking(false);
    }
  }

  async function handleStart() {
    if (!preview || !owns || (needsAup && !aup)) return;
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/wp-migration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceUrl: preview.homeUrl, ownershipAttested: true, acceptAup: aup || undefined, drivenByDashboard: true }),
      });
      const data = await res.json();
      if (res.status === 403 && data.requiresAupAcceptance) {
        setNeedsAup(true);
        return;
      }
      if (res.status === 409 && data.existing) {
        router.push(`/dashboard/migrate/wordpress?site=${data.existing.templateId}&job=${data.existing.id}`);
        return;
      }
      if (!res.ok) {
        setError(data.error ?? "Couldn't start the move — try again.");
        return;
      }
      router.push(`/dashboard/migrate/wordpress?site=${data.templateId}&job=${data.jobId}`);
    } catch {
      setError("We couldn't reach Plexo — check your connection and try again.");
    } finally {
      setStarting(false);
    }
  }

  async function handlePublish() {
    if (!job || !subdomain) return;
    setPublishing(true);
    setPublishError(null);
    try {
      const res = await fetch("/api/v1/domains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: job.templateId, type: "SUBDOMAIN", domain: subdomain }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPublishError(data.error ?? "That address didn't work — try a different one.");
        return;
      }
      await refresh(job.templateId, job.id);
    } catch {
      setPublishError("We couldn't reach Plexo — check your connection and try again.");
    } finally {
      setPublishing(false);
    }
  }

  const frame = (step: WizardStep, content: React.ReactNode, reachable?: WizardStep[], onSelect?: (s: WizardStep) => void) => (
    <div style={{ width: "100%", padding: "8px 0 48px" }}>
      <Stepper current={step} reachable={reachable} onSelect={onSelect} />
      {content}
    </div>
  );

  // ── A move that's started ────────────────────────────────────────────────────
  if (jobId && siteId) {
    if (!job) return frame(2, <p style={muted}>Loading your move…</p>);
    const siteName = job.report?.source.siteName || job.install?.siteName || "your site";

    if (job.phase !== "COMPLETED" || !job.report) {
      return frame(2, <MovingStep job={job} siteName={siteName} onRetry={() => void retry(job.templateId, job.id)} />);
    }

    const report = job.report;
    const previewDomain = domains.find((d) => d.type === "SUBDOMAIN");
    const host = (() => {
      try {
        return new URL(report.source.origin).host.replace(/^www\./, "");
      } catch {
        return "your domain";
      }
    })();
    // Someone who already connected their domain is past checking — open on going live.
    const view = afterView ?? (domains.some((d) => d.type === "CUSTOM") ? "live" : "check");
    const go = (s: WizardStep) => setAfterView(s === 4 ? "live" : "check");

    if (view === "live") {
      return frame(
        4,
        <GoLiveStep host={host} onBack={() => setAfterView("check")}>
          <CutoverPanel templateId={job.templateId} jobId={job.id} />
        </GoLiveStep>,
        [3, 4],
        go,
      );
    }
    return frame(
      3,
      <CheckStep
        report={report}
        siteName={siteName}
        templateId={job.templateId}
        preview={previewDomain}
        subdomain={subdomain}
        onSubdomain={setSubdomain}
        publishing={publishing}
        publishError={publishError}
        onPublish={() => void handlePublish()}
        onContinue={() => {
          setAfterView("live");
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
        privateData={<PrivateDataCard templateId={job.templateId} jobId={job.id} />}
        fullReport={<FullReport report={report} templateId={job.templateId} />}
      />,
      [3, 4],
      go,
    );
  }

  // ── Before the move ──────────────────────────────────────────────────────────
  if (preview) {
    return frame(
      1,
      <ReviewStep
        preview={preview}
        owns={owns}
        onOwns={setOwns}
        needsAup={needsAup}
        aup={aup}
        onAup={setAup}
        starting={starting}
        error={error}
        onStart={() => void handleStart()}
        onBack={() => {
          setPreview(null);
          setError(null);
        }}
      />,
      [0],
      () => setPreview(null),
    );
  }
  return frame(0, <FindSiteStep url={url} onUrl={setUrl} onCheck={(e) => void handleCheck(e)} checking={checking} error={error} upgradeNeeded={upgradeNeeded} existing={existing} />);
}

/** Everything the move did, for anyone who wants the detail: pages, plugins, anything worth a look. */
function FullReport({ report: r, templateId }: { report: Report; templateId: string }) {
  const [showAll, setShowAll] = useState(false);
  const rows = showAll ? r.pages : r.pages.filter((p) => p.kind !== "POST").slice(0, 10);
  const sectionTitle: React.CSSProperties = { margin: "0 0 10px", fontSize: 14, fontWeight: 700, color: "var(--text-main)" };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <p style={muted}>
        {r.summary.filesCopied} files ({mb(r.summary.bytesCopied)}) copied · {r.seo.titles} of {r.seo.pagesChecked} pages kept the same search title
        {r.summary.formsReconnected > 0 ? ` · ${r.summary.formsReconnected} form${r.summary.formsReconnected === 1 ? "" : "s"} reconnected` : ""}.
      </p>

      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
          <p style={sectionTitle}>Pages and posts</p>
          <button type="button" style={{ ...secondaryButton, padding: "5px 10px", fontSize: 12 }} onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Show fewer" : `Show all ${r.pages.length}`}
          </button>
        </div>
        {rows.map((p) => {
          const seoOk = p.seo ? Object.values(p.seo).every(Boolean) : null;
          return (
            <div key={p.key} style={{ display: "flex", gap: 12, alignItems: "center", padding: "9px 0", borderTop: `1px solid ${hairline}` }}>
              <span style={{ fontSize: 13.5, fontWeight: 600, flex: "1 1 45%", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-main)" }}>{p.title}</span>
              <code style={{ fontSize: 12, color: "var(--text-muted)", flex: "1 1 35%", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.newPath ?? p.key}</code>
              <span style={{ fontSize: 12, fontWeight: 650, flexShrink: 0, color: p.status === "FAILED" ? "#f87171" : seoOk === false ? "#f5b74a" : "#34d399" }}>
                {p.status === "FAILED" ? "Not copied" : p.kind === "POST" ? "In your blog" : seoOk ? "Copied" : "Check search title"}
              </span>
            </div>
          );
        })}
      </div>

      <div>
        <p style={sectionTitle}>What happened to each plugin</p>
        <PluginList plugins={r.plugins} />
      </div>

      {(r.brokenLinks.length > 0 || r.missingOnSource.length > 0 || r.failedFiles.length > 0) && (
        <div>
          <p style={sectionTitle}>Worth a look</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {r.failedFiles.map((f) => <p key={f.path} style={{ ...muted, fontSize: 12.5 }}><code>{f.path}</code> — {f.reason}</p>)}
            {r.brokenLinks.map((l) => <p key={`${l.from}${l.href}`} style={{ ...muted, fontSize: 12.5 }}>A link to <code>{l.href}</code> on <code>{l.from}</code> — {l.reason}</p>)}
            {r.missingOnSource.length > 0 && (
              <p style={{ ...muted, fontSize: 12.5 }}>
                {r.missingOnSource.length} file{r.missingOnSource.length === 1 ? " was" : "s were"} already missing on WordPress, so nothing changes for visitors ({r.missingOnSource.slice(0, 3).map((m) => m.path).join(", ")}{r.missingOnSource.length > 3 ? "…" : ""}).
              </p>
            )}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {r.summary.postsCopied > 0 && <Link href={`/dashboard/templates/${templateId}/blog`} style={secondaryButton}>Manage your blog</Link>}
        {r.summary.formsReconnected > 0 && <Link href={`/dashboard/templates/${templateId}/form-submissions`} style={secondaryButton}>Form submissions</Link>}
      </div>
    </div>
  );
}
