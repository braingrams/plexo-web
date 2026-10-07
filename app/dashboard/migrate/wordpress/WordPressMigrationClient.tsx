"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

// "Move from WordPress": the whole owner-facing flow in one screen — find the site,
// show exactly what will move (and what happens to each plugin) before anything is
// created, run the migration with live progress, then hand over a report that says in
// plain language whether it's safe to switch the domain and delete WordPress.

const hairline = "rgba(255,255,255,0.09)";
const PAGES_DOMAIN = process.env.NEXT_PUBLIC_PAGES_DOMAIN || "plexopages.com";

type Outcome = "NATIVE" | "PRESERVED" | "NEEDS_ATTENTION" | "NOT_NEEDED";
interface Plugin { slug: string; name: string; outcome: Outcome; explanation: string }
interface Preview {
  siteName: string;
  siteDescription: string;
  origin: string;
  homeUrl: string;
  inSubdirectory: boolean;
  staticPages: string[];
  counts: { pages: number; posts: number; media: number; categories: number; tags: number };
  theme: { slug: string; parentSlug: string | null } | null;
  plugins: Plugin[];
}
interface Counts { pages: number; pagesDone: number; pagesFailed: number; posts: number; postsDone: number; postsFailed: number; assets: number; assetsDone: number; assetsFailed: number; assetsSkipped: number; products?: number; productsDone?: number; productsSkipped?: number; productsFailed?: number }
interface ChecklistItem { id: string; label: string; status: "done" | "blocked" | "review" | "todo"; detail: string }
interface PageRow { key: string; kind: string; title: string; sourceUrl: string; newPath: string | null; status: string; error: string | null; seo: Record<string, boolean> | null }
interface Report {
  source: { origin: string; homeUrl: string; siteName: string };
  summary: { pagesCopied: number; pagesFailed: number; postsCopied: number; postsFailed: number; filesCopied: number; filesFailed: number; filesAlreadyMissing: number; bytesCopied: number; formsReconnected: number; productsMoved?: number };
  seo: { pagesChecked: number; titles: number; descriptions: number; canonicals: number; structuredData: number; robots: number };
  pages: PageRow[];
  forms: { page: string; name: string; fields: string[] }[];
  brokenLinks: { from: string; href: string; reason: string }[];
  failedFiles: { path: string; reason: string }[];
  missingOnSource: { path: string; from: string | null }[];
  plugins: Plugin[];
  checklist: ChecklistItem[];
  readyForCutover: boolean;
}
interface JobStatus {
  id: string;
  templateId: string;
  sourceUrl: string;
  phase: string;
  pausedIn?: string | null;
  counts: Counts | null;
  report: Report | null;
  errors: string[];
  install?: { siteName?: string; origin?: string };
}
interface DomainRow { domain: string; type: "SUBDOMAIN" | "CUSTOM"; active: boolean; dnsVerified: boolean }

const OUTCOME_GROUPS: { outcome: Outcome; title: string; tone: string }[] = [
  { outcome: "NEEDS_ATTENTION", title: "Needs your attention", tone: "#f5b74a" },
  { outcome: "NATIVE", title: "Replaced by Plexo", tone: "#6ee7a8" },
  { outcome: "PRESERVED", title: "Carried over, works the same", tone: "#8fb4ff" },
  { outcome: "NOT_NEEDED", title: "Not needed on Plexo", tone: "rgba(240,242,255,0.45)" },
];

const PHASE_STEPS: { phase: string; label: string }[] = [
  { phase: "PLANNING", label: "Reading your WordPress site" },
  { phase: "POSTS", label: "Moving blog posts" },
  { phase: "PRODUCTS", label: "Moving your shop's products" },
  { phase: "PAGES", label: "Copying pages and your theme" },
  { phase: "ASSETS", label: "Copying images, fonts and files" },
  { phase: "FINALIZING", label: "Checking every link and SEO tag" },
];

function phaseIndex(phase: string): number {
  if (phase === "PENDING") return 0;
  if (phase === "COMPLETED") return PHASE_STEPS.length;
  return Math.max(0, PHASE_STEPS.findIndex((p) => p.phase === phase));
}

function slugify(input: string): string {
  return input.toLowerCase().replace(/^https?:\/\//, "").replace(/\.[a-z]+$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

function mb(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

const card: React.CSSProperties = { borderRadius: 12, border: `1px solid ${hairline}`, background: "rgba(255,255,255,0.02)", padding: "18px 20px" };
const muted: React.CSSProperties = { fontSize: "12.5px", color: "var(--text-muted)", lineHeight: 1.6, margin: 0 };
const inputStyle: React.CSSProperties = {
  flex: 1, minWidth: 0, background: "rgba(255,255,255,0.04)", border: `1px solid ${hairline}`, borderRadius: 9,
  color: "var(--text-main)", padding: "10px 12px", fontSize: "13.5px", outline: "none", fontFamily: "inherit",
};

function primaryButton(enabled: boolean): React.CSSProperties {
  return {
    fontSize: "13px", fontWeight: 650, color: "var(--bg)", background: enabled ? "var(--text-main)" : "var(--text-faint)",
    padding: "10px 18px", borderRadius: 9, border: "none", cursor: enabled ? "pointer" : "not-allowed", whiteSpace: "nowrap", fontFamily: "inherit",
  };
}
const secondaryButton: React.CSSProperties = {
  fontSize: "12.5px", fontWeight: 650, color: "var(--text-main)", background: "transparent", padding: "9px 16px",
  borderRadius: 9, border: `1px solid ${hairline}`, cursor: "pointer", whiteSpace: "nowrap", fontFamily: "inherit", textDecoration: "none", display: "inline-block",
};

function StatusDot({ status }: { status: ChecklistItem["status"] }) {
  const map = { done: ["#6ee7a8", "✓"], blocked: ["#f87171", "!"], review: ["#f5b74a", "?"], todo: ["rgba(240,242,255,0.35)", "○"] } as const;
  const [color, glyph] = map[status];
  return (
    <span style={{ width: 22, height: 22, borderRadius: 999, border: `1.5px solid ${color}`, color, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, flexShrink: 0 }}>
      {glyph}
    </span>
  );
}

function Stat({ value, label }: { value: string | number; label: string }) {
  return (
    <div style={{ ...card, padding: "14px 16px", flex: "1 1 140px" }}>
      <div style={{ fontSize: "22px", fontWeight: 750, letterSpacing: "-0.02em" }}>{value}</div>
      <div style={{ fontSize: "11.5px", color: "var(--text-muted)", marginTop: 2 }}>{label}</div>
    </div>
  );
}

function PluginGroups({ plugins }: { plugins: Plugin[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {OUTCOME_GROUPS.map((g) => {
        const list = plugins.filter((p) => p.outcome === g.outcome);
        if (list.length === 0) return null;
        return (
          <div key={g.outcome}>
            <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: g.tone, marginBottom: 8 }}>
              {g.title} · {list.length}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {list.map((p) => (
                <div key={p.slug} style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                  <span style={{ fontSize: "12.5px", fontWeight: 650, minWidth: 170, flexShrink: 0 }}>{p.name}</span>
                  <span style={{ ...muted, fontSize: "12px" }}>{p.explanation}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
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
  };
  storeNotes?: string[];
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
    <div style={card}>
      <h3 style={{ margin: "0 0 4px", fontSize: "14px", fontWeight: 700 }}>Copy what WordPress keeps private</h3>
      <p style={{ ...muted, fontSize: "12px", marginBottom: 12 }}>
        Everything visitors see is already on Plexo. A small, read-only WordPress plugin lets Plexo also copy what only lives in your WordPress database:
        past form entries and applications, donation history, drafts, redirect rules and your team. It never changes your WordPress site.
      </p>

      {!connector && (
        <button type="button" style={primaryButton(busy !== "start")} disabled={busy === "start"} onClick={() => void start()}>
          {busy === "start" ? "Preparing…" : "Get the plugin and a connection code"}
        </button>
      )}

      {connector && connector.status !== "CONNECTED" && (
        <ol style={{ ...muted, fontSize: "12.5px", paddingLeft: 18, display: "flex", flexDirection: "column", gap: 10, margin: 0 }}>
          <li>
            <a href="/api/v1/wp-migration/plugin" style={{ color: "var(--brand)", fontWeight: 650 }}>Download the Plexo Migrator plugin</a>, then in WordPress go to <strong>Plugins → Add New → Upload Plugin</strong>, upload it and click <strong>Activate</strong>.
          </li>
          <li>
            In WordPress go to <strong>Tools → Plexo Migrator</strong> and paste this code:
            <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
              <code style={{ ...inputStyle, flex: "1 1 260px", fontSize: "12px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{connector.code}</code>
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
          {extras.team.length > 0 && (
            <div>
              <p style={{ ...muted, fontWeight: 650, color: "#f0f2ff", marginBottom: 6 }}>Invite your team to Plexo</p>
              {extras.team.map((t) => (
                <div key={t.email} style={{ display: "flex", gap: 10, alignItems: "center", padding: "6px 0", borderTop: `1px solid ${hairline}`, flexWrap: "wrap" }}>
                  <span style={{ flex: "1 1 220px", fontSize: "12.5px" }}>{t.name} <span style={muted}>{t.email}</span></span>
                  <span style={{ ...muted, fontSize: "11.5px", minWidth: 120 }}>{plexoRoleFor(t.roles) === "editor" ? "Editor (this site)" : plexoRoleFor(t.roles) === "admin" ? "Admin" : "Blogger"}</span>
                  {invited[t.email] === "sent" ? (
                    <span style={{ fontSize: "12px", color: "#6ee7a8", fontWeight: 650 }}>Invited ✓</span>
                  ) : (
                    <button type="button" style={{ ...secondaryButton, padding: "5px 12px" }} disabled={invited[t.email] === "sending"} onClick={() => void invite(t)}>
                      {invited[t.email] === "sending" ? "Sending…" : "Invite"}
                    </button>
                  )}
                  {invited[t.email] && !["sent", "sending"].includes(invited[t.email]) && <span style={{ ...muted, color: "#f87171", fontSize: "11.5px" }}>{invited[t.email]}</span>}
                </div>
              ))}
            </div>
          )}
          {extras.unmoved.length > 0 && (
            <p style={{ ...muted, fontSize: "11.5px" }}>
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
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
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
    <div style={{ ...card, display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h3 style={{ margin: "0 0 4px", fontSize: "14px", fontWeight: 700 }}>Switch {plan.domain} to Plexo</h3>
        <p style={{ ...muted, fontSize: "12px" }}>
          Your WordPress site keeps serving visitors the whole time — the moment DNS switches, visitors start getting the Plexo copy at exactly the same addresses.
        </p>
      </div>

      {plan.warnings.map((w) => (
        <div key={w} style={{ padding: "10px 12px", borderRadius: 9, border: `1px solid ${/stop|deleted|shut/i.test(w) ? "rgba(245,183,74,0.45)" : hairline}`, background: /stop|deleted|shut/i.test(w) ? "rgba(245,183,74,0.07)" : "transparent" }}>
          <p style={{ ...muted, color: "var(--text-main)", fontSize: "12.5px" }}>{w}</p>
        </div>
      ))}

      <div>
        <p style={{ margin: "0 0 6px", fontSize: "13px", fontWeight: 700 }}>1. Connect your domain in Plexo</p>
        {bothConnected ? (
          <p style={{ ...muted, fontSize: "12px" }}>{view.connected.map((c) => `${c.domain} — ${c.ready ? "certificate ready" : "waiting for DNS"}`).join(" · ")}</p>
        ) : (
          <button type="button" style={primaryButton(busy !== "connect")} disabled={busy === "connect"} onClick={() => void connect()}>
            {busy === "connect" ? "Connecting…" : `Connect ${plan.domain} and ${plan.wwwDomain}`}
          </button>
        )}
      </div>

      {bothConnected && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <p style={{ margin: 0, fontSize: "13px", fontWeight: 700 }}>2. Update your DNS {plan.dnsHost.name !== "unknown" ? `(currently at ${plan.dnsHost.name})` : ""}</p>
          <ol style={{ ...muted, fontSize: "12.5px", paddingLeft: 18, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            {plan.steps.map((step) => <li key={step}>{step}</li>)}
          </ol>
          <div>
            <p style={{ ...muted, fontWeight: 650, color: "var(--text-main)", marginBottom: 4 }}>Add these (Plexo)</p>
            <RecordTable records={plan.plexo} />
            {!plan.plexo.some((r) => /certificate/i.test(r.why)) && <p style={{ ...muted, fontSize: "11.5px", marginTop: 4 }}>The certificate record appears here a few seconds after connecting — refresh if it's missing.</p>}
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
          <p style={{ margin: 0, fontSize: "13px", fontWeight: 700 }}>3. Check it's live — then you can cancel WordPress</p>
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
                    <div style={{ fontSize: "12.5px", fontWeight: 650 }}>{c.label}</div>
                    <p style={{ ...muted, fontSize: "12px" }}>{c.detail}</p>
                  </div>
                </div>
              ))}
              <div style={{ padding: "12px 14px", borderRadius: 10, background: v.safeToCancelWordPress ? "rgba(110,231,168,0.08)" : "rgba(255,255,255,0.03)", border: `1px solid ${v.safeToCancelWordPress ? "rgba(110,231,168,0.35)" : hairline}` }}>
                <p style={{ margin: 0, fontSize: "13px", fontWeight: 700 }}>
                  {v.safeToCancelWordPress ? "It's safe to cancel your WordPress hosting." : "Not yet — keep WordPress running for now."}
                </p>
                <p style={{ ...muted, fontSize: "12px", marginTop: 4 }}>
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
  const [existing, setExisting] = useState<{ id: string; templateId: string; siteName: string | null; phase: string } | null>(null);
  const [subdomain, setSubdomain] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [showAllPages, setShowAllPages] = useState(false);
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

  // Drive the migration while this screen is open. The server does the work in bounded
  // steps; if the tab closes, a scheduled job carries on.
  const runLoop = useCallback(
    async (templateId: string, id: string) => {
      if (loopRef.current) return;
      loopRef.current = true;
      try {
        for (;;) {
          const stepRes = await fetch(`/api/v1/wp-migration/${templateId}/${id}/step`, { method: "POST" });
          const current = await refresh(templateId, id);
          if (!stepRes.ok || !current) break;
          const step = (await stepRes.json()) as { done: boolean; phase: string };
          if (step.done || step.phase === "PAUSED_ERROR" || current.phase === "COMPLETED") break;
        }
      } finally {
        loopRef.current = false;
      }
    },
    [refresh],
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
      .then((data: { migrations: { id: string; templateId: string; siteName: string | null; phase: string }[] } | null) => {
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
        body: JSON.stringify({ sourceUrl: preview.homeUrl, ownershipAttested: true, acceptAup: aup || undefined }),
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
        setError(data.error ?? "Couldn't start the migration — try again.");
        return;
      }
      router.push(`/dashboard/migrate/wordpress?site=${data.templateId}&job=${data.jobId}`);
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
        setPublishError(data.error ?? "Couldn't publish — try a different address.");
        return;
      }
      await refresh(job.templateId, job.id);
    } finally {
      setPublishing(false);
    }
  }

  // ── Running / report ──────────────────────────────────────────────────────────
  if (jobId && siteId) {
    if (!job) return <p style={muted}>Loading your migration…</p>;
    const siteName = job.report?.source.siteName || job.install?.siteName || "Your site";
    const sourceHost = (() => {
      try {
        return new URL(job.report?.source.origin || job.install?.origin || job.sourceUrl).host;
      } catch {
        return job.sourceUrl;
      }
    })();

    if (job.phase !== "COMPLETED" || !job.report) {
      const c = job.counts;
      const idx = phaseIndex(job.phase === "PAUSED_ERROR" ? job.pausedIn ?? "PLANNING" : job.phase);
      const paused = job.phase === "PAUSED_ERROR";
      const failed = job.phase === "FAILED";
      return (
        <div style={{ maxWidth: 720, display: "flex", flexDirection: "column", gap: 20 }}>
          <div>
            <h2 style={{ margin: "0 0 4px", fontSize: "18px", fontWeight: 700 }}>Moving {siteName} to Plexo</h2>
            <p style={muted}>
              From {sourceHost}. Your WordPress site stays exactly as it is — nothing there is changed. You can close this tab; we&rsquo;ll keep going and the
              report will be here when you come back.
            </p>
          </div>
          <div style={{ ...card, display: "flex", flexDirection: "column", gap: 12 }}>
            {PHASE_STEPS.map((s, i) => {
              // The products step only exists for a site with a WooCommerce shop.
              if (s.phase === "PRODUCTS" && !(c?.products && c.products > 0)) return null;
              const state = i < idx ? "done" : i === idx && !paused && !failed ? "active" : "todo";
              let detail = "";
              if (c && s.phase === "PRODUCTS" && c.products) detail = `${(c.productsDone ?? 0) + (c.productsSkipped ?? 0) + (c.productsFailed ?? 0)} of ${c.products}`;
              if (c && s.phase === "POSTS" && c.posts > 0) detail = `${c.postsDone} of ${c.posts}`;
              if (c && s.phase === "PAGES" && c.pages > 0) detail = `${c.pagesDone} of ${c.pages}`;
              if (c && s.phase === "ASSETS" && c.assets > 0) detail = `${c.assetsDone + c.assetsFailed + c.assetsSkipped} of ${c.assets}`;
              return (
                <div key={s.phase} style={{ display: "flex", alignItems: "center", gap: 12, opacity: state === "todo" ? 0.5 : 1 }}>
                  <span
                    style={{
                      width: 20, height: 20, borderRadius: 999, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800,
                      background: state === "done" ? "#6ee7a8" : "transparent", color: "#0b0f19",
                      border: state === "done" ? "none" : `1.5px solid ${state === "active" ? "var(--brand)" : hairline}`,
                    }}
                  >
                    {state === "done" ? "✓" : ""}
                  </span>
                  <span style={{ fontSize: "13px", fontWeight: state === "active" ? 700 : 550, flex: 1 }}>{s.label}{state === "active" ? "…" : ""}</span>
                  {detail && <span style={{ fontSize: "12px", color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>{detail}</span>}
                </div>
              );
            })}
          </div>
          {(paused || failed) && (
            <div style={{ ...card, borderColor: "rgba(248,113,113,0.4)" }}>
              <p style={{ margin: "0 0 6px", fontSize: "13px", fontWeight: 700 }}>{failed ? "This migration stopped" : "The migration paused"}</p>
              <p style={{ ...muted, marginBottom: 12 }}>
                {job.errors[job.errors.length - 1] ?? "Something went wrong."} {failed ? "Start a new migration to try again." : "This is usually temporary (your WordPress host was slow or briefly offline) — trying again picks up exactly where it stopped."}
              </p>
              {failed ? (
                <Link href="/dashboard/migrate/wordpress" style={secondaryButton}>Start again</Link>
              ) : (
                <button type="button" style={primaryButton(true)} onClick={() => void runLoop(job.templateId, job.id)}>Try again</button>
              )}
            </div>
          )}
        </div>
      );
    }

    const r = job.report;
    const preview_ = domains.find((d) => d.type === "SUBDOMAIN");
    const custom = domains.find((d) => d.type === "CUSTOM");
    const checklist = r.checklist.map((item) => {
      if (item.id === "publish" && preview_) return { ...item, status: "done" as const, detail: `Live at ${preview_.domain} — click around and compare it with your WordPress site.` };
      if (item.id === "domain" && custom) {
        return custom.dnsVerified
          ? { ...item, status: "done" as const, detail: `${custom.domain} now points to Plexo. Once you've confirmed it shows your Plexo site, you can cancel your WordPress hosting.` }
          : { ...item, status: "review" as const, detail: `${custom.domain} is connected — finish the DNS step in Domains. Keep WordPress running until it's verified.` };
      }
      return item;
    });
    const blocked = checklist.filter((c) => c.status === "blocked");
    const pageRows = r.pages.filter((p) => p.kind !== "POST");
    const shownPages = showAllPages ? r.pages : pageRows.slice(0, 8);

    return (
      <div style={{ maxWidth: 880, display: "flex", flexDirection: "column", gap: 22 }}>
        <div>
          <h2 style={{ margin: "0 0 4px", fontSize: "19px", fontWeight: 750 }}>{siteName} is on Plexo</h2>
          <p style={muted}>
            Every page, post, image and file from {sourceHost} has been copied, at the same web addresses. Your WordPress site hasn&rsquo;t been touched.
          </p>
        </div>

        <div
          style={{
            ...card,
            borderColor: blocked.length ? "rgba(248,113,113,0.35)" : "rgba(110,231,168,0.35)",
            background: blocked.length ? "rgba(248,113,113,0.05)" : "rgba(110,231,168,0.05)",
          }}
        >
          <p style={{ margin: 0, fontSize: "13.5px", fontWeight: 700 }}>
            {blocked.length
              ? `${blocked.length} thing${blocked.length > 1 ? "s" : ""} to finish before you switch your domain`
              : custom?.dnsVerified
                ? "All done — your domain is on Plexo"
                : "Ready to switch your domain"}
          </p>
          <p style={{ ...muted, marginTop: 4 }}>
            {blocked.length
              ? "Switching now would break the items marked below for your visitors, so finish them first. Everything else is ready."
              : "Preview the site, then point your domain to Plexo. Keep WordPress running until your domain shows the Plexo site — after that, it's safe to delete."}
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {checklist.map((item) => (
            <div key={item.id} style={{ ...card, display: "flex", gap: 14, padding: "14px 18px" }}>
              <StatusDot status={item.status} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "13px", fontWeight: 700, marginBottom: 2 }}>{item.label}</div>
                <p style={{ ...muted, fontSize: "12px" }}>{item.detail}</p>
                {item.id === "publish" && !preview_ && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flex: "1 1 280px" }}>
                        <input value={subdomain} onChange={(e) => setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} style={inputStyle} aria-label="Preview address" />
                        <span style={{ fontSize: "12.5px", color: "var(--text-muted)", whiteSpace: "nowrap" }}>.{PAGES_DOMAIN}</span>
                      </div>
                      <button type="button" style={primaryButton(!publishing && Boolean(subdomain))} disabled={publishing || !subdomain} onClick={() => void handlePublish()}>
                        {publishing ? "Publishing…" : "Publish preview"}
                      </button>
                    </div>
                    {publishError && <p style={{ ...muted, color: "#f87171", marginTop: 6 }}>{publishError}</p>}
                  </div>
                )}
                {item.id === "publish" && preview_ && (
                  <a href={`https://${preview_.domain}${new URL(r.source.homeUrl).pathname}`} target="_blank" rel="noreferrer" style={{ ...secondaryButton, marginTop: 10 }}>Open preview ↗</a>
                )}
                {item.id === "domain" && (
                  <a href="#switch-domain" style={{ ...secondaryButton, marginTop: 10 }}>See the steps ↓</a>
                )}
                {item.id === "payments" && (
                  <Link
                    href={item.status === "done" ? `/dashboard/commerce/${job.templateId}/donations` : `/dashboard/commerce/${job.templateId}/settings/payments`}
                    style={{ ...secondaryButton, marginTop: 10 }}
                  >
                    {item.status === "done" ? "Open Donations →" : "Connect payments →"}
                  </Link>
                )}
                {item.id === "payments-other" && (
                  <Link href={`/dashboard/commerce/${job.templateId}`} style={{ ...secondaryButton, marginTop: 10 }}>Open Commerce →</Link>
                )}
                {item.id === "team-access" && (
                  <Link href="/dashboard/settings/team" style={{ ...secondaryButton, marginTop: 10 }}>Invite your team →</Link>
                )}
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Stat value={r.summary.pagesCopied} label="pages copied" />
          <Stat value={r.summary.postsCopied} label="blog posts moved" />
          {r.summary.productsMoved != null && <Stat value={r.summary.productsMoved} label="products moved" />}
          <Stat value={r.summary.filesCopied} label={`files (${mb(r.summary.bytesCopied)})`} />
          <Stat value={`${r.seo.titles}/${r.seo.pagesChecked}`} label="pages with identical SEO" />
          {r.summary.formsReconnected > 0 && <Stat value={r.summary.formsReconnected} label="forms reconnected" />}
        </div>

        <PrivateDataCard templateId={job.templateId} jobId={job.id} />

        <div id="switch-domain">
          <CutoverPanel templateId={job.templateId} jobId={job.id} />
        </div>

        <div style={card}>
          <h3 style={{ margin: "0 0 12px", fontSize: "14px", fontWeight: 700 }}>What happened to each plugin</h3>
          <PluginGroups plugins={r.plugins} />
        </div>

        <div style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
            <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 700 }}>Pages and posts</h3>
            <button type="button" style={{ ...secondaryButton, padding: "5px 10px", fontSize: "11.5px" }} onClick={() => setShowAllPages((v) => !v)}>
              {showAllPages ? "Show fewer" : `Show all ${r.pages.length}`}
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {shownPages.map((p) => {
              const seoOk = p.seo ? Object.values(p.seo).every(Boolean) : null;
              return (
                <div key={p.key} style={{ display: "flex", gap: 12, alignItems: "center", padding: "8px 0", borderTop: `1px solid ${hairline}` }}>
                  <span style={{ fontSize: "12.5px", fontWeight: 600, flex: "1 1 40%", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.title}</span>
                  <code style={{ fontSize: "11.5px", color: "var(--text-muted)", flex: "1 1 40%", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.newPath ?? p.key}</code>
                  <span style={{ fontSize: "11.5px", fontWeight: 650, color: p.status === "FAILED" ? "#f87171" : seoOk === false ? "#f5b74a" : "#6ee7a8", flexShrink: 0 }}>
                    {p.status === "FAILED" ? "Not copied" : p.kind === "POST" ? "Moved to blog" : seoOk ? "Identical SEO" : "Check SEO"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {(r.brokenLinks.length > 0 || r.missingOnSource.length > 0 || r.failedFiles.length > 0) && (
          <div style={card}>
            <h3 style={{ margin: "0 0 10px", fontSize: "14px", fontWeight: 700 }}>Worth a look</h3>
            {r.failedFiles.map((f) => (
              <p key={f.path} style={{ ...muted, fontSize: "12px" }}><code>{f.path}</code> — {f.reason}</p>
            ))}
            {r.brokenLinks.map((l) => (
              <p key={`${l.from}${l.href}`} style={{ ...muted, fontSize: "12px" }}>
                Link to <code>{l.href}</code> on <code>{l.from}</code> — {l.reason}
              </p>
            ))}
            {r.missingOnSource.length > 0 && (
              <p style={{ ...muted, fontSize: "12px" }}>
                {r.missingOnSource.length} file(s) your pages refer to were already missing on WordPress (so nothing changes for visitors): {r.missingOnSource.slice(0, 3).map((m) => m.path).join(", ")}
                {r.missingOnSource.length > 3 ? "…" : ""}
              </p>
            )}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link href={`/dashboard/templates/${job.templateId}`} style={secondaryButton}>Edit your pages</Link>
          {r.summary.postsCopied > 0 && <Link href={`/dashboard/templates/${job.templateId}/blog`} style={secondaryButton}>Manage your blog</Link>}
          {r.summary.formsReconnected > 0 && <Link href={`/dashboard/templates/${job.templateId}/form-submissions`} style={secondaryButton}>Form submissions</Link>}
        </div>
      </div>
    );
  }

  // ── Start ─────────────────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 760, display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <h2 style={{ margin: "0 0 4px", fontSize: "19px", fontWeight: 750 }}>Move your WordPress site to Plexo</h2>
        <p style={muted}>
          Enter your website&rsquo;s address. Plexo copies every page, blog post, image and file, keeps your design and your web addresses exactly as they are,
          and reconnects your forms — then helps you point your domain here. Nothing on WordPress is changed.
        </p>
      </div>

      {existing && (
        <div style={{ ...card, display: "flex", alignItems: "center", gap: 12, justifyContent: "space-between", flexWrap: "wrap" }}>
          <p style={{ ...muted, margin: 0 }}>You have a migration in progress{existing.siteName ? ` for ${existing.siteName}` : ""}.</p>
          <Link href={`/dashboard/migrate/wordpress?site=${existing.templateId}&job=${existing.id}`} style={secondaryButton}>Continue it →</Link>
        </div>
      )}

      <form onSubmit={handleCheck} style={{ display: "flex", gap: 8 }}>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="yourwebsite.com" style={inputStyle} autoFocus aria-label="Your WordPress site's address" />
        <button type="submit" style={primaryButton(!checking && Boolean(url.trim()))} disabled={checking || !url.trim()}>
          {checking ? "Looking at your site…" : "Check my site"}
        </button>
      </form>

      {error && (
        <div style={{ ...card, borderColor: "rgba(248,113,113,0.35)" }}>
          <p style={{ ...muted, color: "var(--text-main)" }}>{error}</p>
          {upgradeNeeded && (
            <Link href="/dashboard/settings/subscription?upgrade=ULTRA&returnTo=/dashboard/migrate/wordpress" style={{ ...secondaryButton, marginTop: 10 }}>See Ultra →</Link>
          )}
        </div>
      )}

      {preview && (
        <>
          <div style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
              <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 750 }}>{preview.siteName || new URL(preview.origin).host}</h3>
              <span style={{ fontSize: "11.5px", color: "#6ee7a8", fontWeight: 650 }}>WordPress found</span>
            </div>
            {preview.siteDescription && <p style={{ ...muted, marginTop: 4 }}>{preview.siteDescription}</p>}
            {(preview.inSubdirectory || preview.staticPages.length > 0) && (
              <p style={{ ...muted, marginTop: 10, fontSize: "12px" }}>
                {preview.inSubdirectory && <>WordPress is installed at <code>{new URL(preview.homeUrl).pathname}</code>. </>}
                {preview.staticPages.length > 0 && (
                  <>
                    We also found {preview.staticPages.length} page{preview.staticPages.length > 1 ? "s" : ""} in front of it that aren&rsquo;t part of WordPress (
                    {preview.staticPages.map((p) => new URL(p).pathname).join(", ")}) — those move too.
                  </>
                )}
              </p>
            )}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
              <Stat value={preview.counts.pages} label="pages" />
              <Stat value={preview.counts.posts} label="blog posts" />
              <Stat value={preview.counts.media} label="images & files" />
              {preview.theme && <Stat value={preview.theme.parentSlug ? `${preview.theme.parentSlug}` : preview.theme.slug} label={preview.theme.parentSlug ? "theme (with your customizations)" : "theme"} />}
            </div>
          </div>

          <div style={card}>
            <h3 style={{ margin: "0 0 4px", fontSize: "14px", fontWeight: 700 }}>Your plugins on Plexo</h3>
            <p style={{ ...muted, marginBottom: 14, fontSize: "12px" }}>Here&rsquo;s what will happen to each one. You&rsquo;ll get a full checklist at the end.</p>
            <PluginGroups plugins={preview.plugins} />
          </div>

          <div style={{ ...card, display: "flex", flexDirection: "column", gap: 10 }}>
            <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: "12.5px", cursor: "pointer" }}>
              <input type="checkbox" checked={owns} onChange={(e) => setOwns(e.target.checked)} style={{ marginTop: 2 }} />
              <span>I own this website, or have the owner&rsquo;s permission to move it.</span>
            </label>
            {needsAup && (
              <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: "12.5px", cursor: "pointer" }}>
                <input type="checkbox" checked={aup} onChange={(e) => setAup(e.target.checked)} style={{ marginTop: 2 }} />
                <span>
                  I agree to Plexo&rsquo;s{" "}
                  <Link href="/legal/acceptable-use" target="_blank" style={{ color: "var(--brand)" }}>Acceptable Use Policy</Link>.
                </span>
              </label>
            )}
            <div>
              <button type="button" style={primaryButton(owns && (!needsAup || aup) && !starting)} disabled={!owns || (needsAup && !aup) || starting} onClick={() => void handleStart()}>
                {starting ? "Starting…" : `Move ${preview.siteName || "my site"} to Plexo`}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
