import { Resolver } from "node:dns/promises";
import type { EntityItem } from "electrodb";
import { PublishedDomain } from "@/lib/db/contentEntities";
import { WpMigrationJob } from "@/lib/db/importEntities";
import { getRoutingEndpoint } from "@/lib/cloudfrontDomains";
import { migrationFetch } from "./http";
import type { MigrationReport } from "./report";

// Moving the domain is where real migrations break: an apex domain that can't take a
// CNAME, email silently lost because MX records were overwritten, or the owner cancels the
// old hosting — and with it the DNS zone the hosting company was serving, taking the
// website AND email down. This reads the domain's live DNS, explains in plain language
// what has to change and what must not, produces the exact records (and an importable zone
// file), then verifies — URL by URL, on the real domain — that Plexo is serving the site
// before it ever says WordPress can be cancelled.

type JobItem = EntityItem<typeof WpMigrationJob>;

const resolver = new Resolver();
// Public resolvers, so the answer is what the internet sees — not a stale cache of ours.
resolver.setServers(["1.1.1.1", "8.8.8.8"]);

async function q<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export interface DnsHost {
  name: string;
  nameservers: string[];
  /** DNS served by the WordPress web host itself — cancelling the hosting deletes the DNS zone. */
  tiedToWebHost: boolean;
  /** Whether the provider can point the bare domain (apex) at a hostname: ALIAS/ANAME/CNAME flattening. */
  apexHostnameSupport: "yes" | "no" | "unknown";
  apexRecordType: string;
}

export interface EmailSetup {
  provider: string;
  /** Mail is hosted by the same company as the WordPress site — cancelling hosting stops email. */
  onWebHost: boolean;
  mx: { priority: number; exchange: string }[];
}

export interface DnsRecord {
  name: string; // "@", "www", "google._domainkey", ...
  type: "A" | "AAAA" | "CNAME" | "MX" | "TXT" | "ALIAS";
  value: string;
  priority?: number;
  why: string;
}

export interface CutoverPlan {
  domain: string;
  wwwDomain: string;
  dnsHost: DnsHost;
  email: EmailSetup | null;
  current: { apex: string[]; www: string[] };
  /** Records that must survive unchanged (email, verification, SPF/DKIM/DMARC). */
  keep: DnsRecord[];
  /** Records to add or change so the domain points at Plexo. */
  plexo: DnsRecord[];
  /** BIND zone file with keep + plexo, for providers that import zone files (Cloudflare, Namecheap). */
  zoneFile: string;
  steps: string[];
  warnings: string[];
  analyzedAt: string;
}

interface ProviderInfo {
  match: RegExp;
  name: string;
  tiedToWebHost: boolean;
  apex: DnsHost["apexHostnameSupport"];
  apexRecordType: string;
}

// NS suffix → provider. "tiedToWebHost" marks web-hosting control panels (cPanel/Plesk
// DNS that lives and dies with a hosting plan), the case that would take a site offline if
// the owner cancels their WordPress hosting after moving.
const DNS_PROVIDERS: ProviderInfo[] = [
  { match: /\.cloudflare\.com$/, name: "Cloudflare", tiedToWebHost: false, apex: "yes", apexRecordType: "CNAME (Cloudflare flattens it at the root automatically; set the proxy to “DNS only”)" },
  { match: /registrar-servers\.com$/, name: "Namecheap BasicDNS", tiedToWebHost: false, apex: "yes", apexRecordType: "ALIAS" },
  { match: /(namecheaphosting\.com|web-hosting\.com)$/, name: "Namecheap Hosting (cPanel)", tiedToWebHost: true, apex: "no", apexRecordType: "A" },
  { match: /domaincontrol\.com$/, name: "GoDaddy", tiedToWebHost: false, apex: "no", apexRecordType: "A (GoDaddy has no ALIAS)" },
  { match: /awsdns/, name: "Amazon Route 53", tiedToWebHost: false, apex: "yes", apexRecordType: "ALIAS (A, alias to the CloudFront target)" },
  { match: /dnsimple/, name: "DNSimple", tiedToWebHost: false, apex: "yes", apexRecordType: "ALIAS" },
  { match: /(googledomains\.com|squarespacedns\.com|squarespace\.com)$/, name: "Squarespace Domains", tiedToWebHost: false, apex: "no", apexRecordType: "A" },
  { match: /(ui-dns\.(com|de|org|biz))$/, name: "IONOS", tiedToWebHost: false, apex: "no", apexRecordType: "A" },
  { match: /(porkbun\.com)$/, name: "Porkbun", tiedToWebHost: false, apex: "yes", apexRecordType: "ALIAS" },
  { match: /(name\.com)$/, name: "Name.com", tiedToWebHost: false, apex: "yes", apexRecordType: "ANAME" },
  { match: /(dnsmadeeasy\.com)$/, name: "DNS Made Easy", tiedToWebHost: false, apex: "yes", apexRecordType: "ANAME" },
  { match: /(digitalocean\.com)$/, name: "DigitalOcean", tiedToWebHost: false, apex: "no", apexRecordType: "A" },
  { match: /(bluehost\.com)$/, name: "Bluehost", tiedToWebHost: true, apex: "no", apexRecordType: "A" },
  { match: /(hostgator\.com|websitewelcome\.com)$/, name: "HostGator", tiedToWebHost: true, apex: "no", apexRecordType: "A" },
  { match: /(siteground\.net|sgvps\.net)$/, name: "SiteGround", tiedToWebHost: true, apex: "no", apexRecordType: "A" },
  { match: /(dns-parking\.com|hostinger\.com)$/, name: "Hostinger", tiedToWebHost: true, apex: "no", apexRecordType: "A" },
  { match: /(dreamhost\.com)$/, name: "DreamHost", tiedToWebHost: true, apex: "no", apexRecordType: "A" },
  { match: /(inmotionhosting\.com|a2hosting\.com|greengeeks\.(com|net)|hostpapa\.com|interserver\.net|hostmonster\.com|justhost\.com|ipage\.com|fatcow\.com|ehost\.com)$/, name: "your web host", tiedToWebHost: true, apex: "no", apexRecordType: "A" },
  { match: /(wpengine|kinsta|flywheel)/, name: "your WordPress host", tiedToWebHost: true, apex: "no", apexRecordType: "A" },
];

const EMAIL_PROVIDERS: { match: RegExp; name: string; dkim: string[] }[] = [
  { match: /(google\.com|googlemail\.com)\.?$/, name: "Google Workspace", dkim: ["google._domainkey"] },
  { match: /(outlook\.com|office365\.com)\.?$/, name: "Microsoft 365", dkim: ["selector1._domainkey", "selector2._domainkey"] },
  { match: /zoho\.(com|eu|in)\.?$/, name: "Zoho Mail", dkim: ["zmail._domainkey", "zoho._domainkey"] },
  { match: /mxroute/, name: "MXroute", dkim: ["x._domainkey"] },
  { match: /(protonmail\.ch|proton\.me)\.?$/, name: "Proton Mail", dkim: ["protonmail._domainkey", "protonmail2._domainkey", "protonmail3._domainkey"] },
  { match: /messagingengine\.com\.?$/, name: "Fastmail", dkim: ["fm1._domainkey", "fm2._domainkey", "fm3._domainkey"] },
  { match: /icloud\.com\.?$/, name: "iCloud Mail", dkim: ["sig1._domainkey"] },
];

function apexOf(domain: string): string {
  return domain.replace(/^www\./, "");
}

export async function analyzeDomain(origin: string, opts: { routingEndpoint: string; validations: { name: string; value: string }[] }): Promise<CutoverPlan> {
  const host = new URL(origin).host;
  const domain = apexOf(host);
  const wwwDomain = `www.${domain}`;
  const [ns, apexA, apexAAAA, wwwCname, wwwA, mx, apexTxt, dmarc] = await Promise.all([
    q(() => resolver.resolveNs(domain), [] as string[]),
    q(() => resolver.resolve4(domain), [] as string[]),
    q(() => resolver.resolve6(domain), [] as string[]),
    q(() => resolver.resolveCname(wwwDomain), [] as string[]),
    q(() => resolver.resolve4(wwwDomain), [] as string[]),
    q(() => resolver.resolveMx(domain), [] as { priority: number; exchange: string }[]),
    q(() => resolver.resolveTxt(domain), [] as string[][]),
    q(() => resolver.resolveTxt(`_dmarc.${domain}`), [] as string[][]),
  ]);

  const nameservers = ns.map((n) => n.toLowerCase().replace(/\.$/, ""));
  const provider = DNS_PROVIDERS.find((p) => nameservers.some((n) => p.match.test(n)));
  // Nameservers named after the site's own domain are a self-hosted/cPanel setup — also tied to the host.
  const selfHosted = nameservers.some((n) => n.endsWith(`.${domain}`));
  const dnsHost: DnsHost = {
    name: provider?.name ?? (nameservers[0] ? nameservers[0].split(".").slice(-2).join(".") : "unknown"),
    nameservers,
    tiedToWebHost: provider?.tiedToWebHost ?? selfHosted,
    apexHostnameSupport: provider?.apex ?? "unknown",
    apexRecordType: provider?.apexRecordType ?? "ALIAS or ANAME (if your DNS provider offers one)",
  };

  let email: EmailSetup | null = null;
  const keep: DnsRecord[] = [];
  if (mx.length > 0) {
    const exchanges = mx.map((m) => m.exchange.toLowerCase());
    const known = EMAIL_PROVIDERS.find((p) => exchanges.some((e) => p.match.test(e)));
    const mxIps = (await Promise.all(exchanges.map((e) => q(() => resolver.resolve4(e), [] as string[])))).flat();
    const onWebHost = !known && (mxIps.some((ip) => apexA.includes(ip)) || exchanges.some((e) => e.endsWith(domain)));
    email = { provider: known?.name ?? (onWebHost ? "your web host" : exchanges[0]), onWebHost, mx: mx.sort((a, b) => a.priority - b.priority) };
    for (const m of email.mx) keep.push({ name: "@", type: "MX", value: m.exchange.replace(/\.?$/, "."), priority: m.priority, why: `Delivers your email (${email.provider})` });
    for (const sel of known?.dkim ?? ["default._domainkey"]) {
      const txt = await q(() => resolver.resolveTxt(`${sel}.${domain}`), [] as string[][]);
      for (const t of txt) keep.push({ name: sel, type: "TXT", value: t.join(""), why: "Email signing (DKIM) — keeps your mail out of spam" });
      const cname = txt.length ? [] : await q(() => resolver.resolveCname(`${sel}.${domain}`), [] as string[]);
      for (const c of cname) keep.push({ name: sel, type: "CNAME", value: c.replace(/\.?$/, "."), why: "Email signing (DKIM) — keeps your mail out of spam" });
    }
  }
  for (const t of apexTxt) {
    const value = t.join("");
    const why = /^v=spf1/i.test(value)
      ? "Says which servers may send email for your domain (SPF)"
      : /^v=DKIM1/i.test(value)
        ? "Email signing key"
        : /verification|verify|site-verification/i.test(value)
          ? "Proves ownership to a service (e.g. Google) — removing it can unlink that service"
          : "Existing TXT record";
    keep.push({ name: "@", type: "TXT", value, why });
  }
  for (const t of dmarc) keep.push({ name: "_dmarc", type: "TXT", value: t.join(""), why: "Email anti-spoofing policy (DMARC)" });

  const plexo: DnsRecord[] = [
    {
      name: "@",
      type: dnsHost.apexHostnameSupport === "yes" ? (dnsHost.name === "Cloudflare" ? "CNAME" : "ALIAS") : "ALIAS",
      value: `${opts.routingEndpoint}.`,
      why: `Points ${domain} at Plexo (replaces the current A record${apexA.length > 1 ? "s" : ""} ${apexA.join(", ") || ""})`.trim(),
    },
    { name: "www", type: "CNAME", value: `${opts.routingEndpoint}.`, why: `Points ${wwwDomain} at Plexo (it then redirects to ${domain}, as before)` },
    ...opts.validations.map((v) => ({
      name: v.name.replace(new RegExp(`\\.?${domain.replace(/\./g, "\\.")}\\.?$`), "") || "@",
      type: "CNAME" as const,
      value: v.value.replace(/\.?$/, "."),
      why: "Proves you own the domain so Plexo can issue its security (HTTPS) certificate",
    })),
  ];

  const warnings: string[] = [];
  const steps: string[] = [];
  if (dnsHost.tiedToWebHost) {
    warnings.push(
      `Your DNS is hosted by ${dnsHost.name} as part of your WordPress hosting plan. If you cancel that plan, your domain's DNS is deleted with it — your website${email ? " and your email" : ""} would stop working. Move your DNS to a free DNS provider you'll keep before cancelling (step 1).`,
    );
  }
  if (email?.onWebHost) {
    warnings.push(`Your email is hosted by your web host. Cancelling your WordPress hosting would also shut down your email — move your mailboxes (e.g. to Google Workspace or Zoho) first, or keep the hosting plan just for email.`);
  } else if (email) {
    warnings.push(`Your email runs on ${email.provider}. It keeps working as long as the email records listed under “Keep exactly as they are” stay in place — never delete or edit them.`);
  }

  if (dnsHost.tiedToWebHost || dnsHost.apexHostnameSupport === "no") {
    steps.push(
      `Move your DNS to Cloudflare (free): create a Cloudflare account, add ${domain}, choose “Upload a DNS zone file” and upload the zone file below — it already contains every record to keep plus Plexo's. Then, at the company where you registered ${domain}, replace the nameservers with the two Cloudflare gives you.`,
    );
  } else {
    steps.push(`Sign in to ${dnsHost.name} and open the DNS settings for ${domain}.`);
    steps.push(`Delete the current A record${apexA.length > 1 ? "s" : ""} for “@”${apexAAAA.length ? " (and AAAA records)" : ""} and the “www” record, then add the Plexo records below.`);
  }
  steps.push("Don't touch the records under “Keep exactly as they are”.");
  steps.push("Come back here and click “Check my domain”. DNS changes usually show up within an hour (occasionally up to 48 hours) — your WordPress site keeps serving visitors until then, so nobody sees downtime.");

  return {
    domain,
    wwwDomain,
    dnsHost,
    email,
    current: { apex: [...apexA, ...apexAAAA], www: wwwCname.length ? wwwCname : wwwA },
    keep,
    plexo,
    zoneFile: buildZoneFile(domain, [...keep, ...plexo]),
    steps,
    warnings,
    analyzedAt: new Date().toISOString(),
  };
}

function zoneName(name: string): string {
  return name === "@" ? "@" : name;
}

function quoteTxt(value: string): string {
  // BIND splits long TXT values into 255-char quoted strings.
  const chunks = value.match(/.{1,255}/g) ?? [""];
  return chunks.map((c) => `"${c.replace(/"/g, '\\"')}"`).join(" ");
}

function buildZoneFile(domain: string, records: DnsRecord[]): string {
  const lines = [`$ORIGIN ${domain}.`, "$TTL 3600", "; Generated by Plexo for moving your website. Email and verification records are copied exactly from your current DNS.", ""];
  for (const r of records) {
    const type = r.type === "ALIAS" ? "CNAME" : r.type; // zone-file importers (Cloudflare) flatten a root CNAME
    const value = r.type === "TXT" ? quoteTxt(r.value) : r.type === "MX" ? `${r.priority ?? 10} ${r.value}` : r.value;
    lines.push(`${zoneName(r.name)}\t3600\tIN\t${type}\t${value}\t; ${r.why}`);
  }
  return `${lines.join("\n")}\n`;
}

export interface LiveCheck {
  id: string;
  label: string;
  status: "done" | "blocked" | "todo" | "review";
  detail: string;
}

export interface LiveVerification {
  checkedAt: string;
  checks: LiveCheck[];
  pages: { ok: number; total: number; failures: { path: string; problem: string }[] };
  safeToCancelWordPress: boolean;
}

/**
 * The final word before the owner deletes WordPress: is the real domain now served by
 * Plexo for EVERY migrated URL, is email intact, is DNS somewhere that survives cancelling
 * the hosting, and is nothing in the migration checklist still blocking?
 */
export async function verifyLive(job: JobItem, plan: CutoverPlan, report: MigrationReport): Promise<LiveVerification> {
  const checks: LiveCheck[] = [];
  const domain = plan.domain;
  const canonicalHost = new URL(report.source.origin).host;

  const { data: domains } = await PublishedDomain.query.primary({ templateId: job.templateId }).go();
  const connected = domains.filter((d) => d.type === "CUSTOM" && (d.domain === domain || d.domain === plan.wwwDomain));
  checks.push({
    id: "connected",
    label: `${domain} connected to this site in Plexo`,
    status: connected.some((d) => d.domain === canonicalHost) ? "done" : "todo",
    detail: connected.length ? connected.map((d) => `${d.domain}: ${(d as { certificateStatus?: string }).certificateStatus === "ISSUED" || d.dnsVerified ? "certificate ready" : "waiting for the DNS records"}`).join("; ") : "Click “Connect my domain” first.",
  });

  // Every migrated URL, on the real domain, must come back from Plexo (X-Plexo-Site) — not WordPress.
  const paths = report.pages.filter((p) => p.newPath && p.status === "DONE").map((p) => p.newPath!);
  const failures: { path: string; problem: string }[] = [];
  let ok = 0;
  const batch = async (path: string) => {
    try {
      const res = await migrationFetch(`https://${canonicalHost}${encodeURI(path)}`, { headers: { Accept: "text/html" } });
      if (res.headers.get("x-plexo-site") !== job.templateId) failures.push({ path, problem: "Still served by your old host (DNS hasn't switched yet)" });
      else if (!res.ok) failures.push({ path, problem: `Answered ${res.status}` });
      else ok += 1;
      await res.body?.cancel().catch(() => {});
    } catch (err) {
      failures.push({ path, problem: err instanceof Error ? err.message : "Couldn't load" });
    }
  };
  for (let i = 0; i < paths.length; i += 6) await Promise.all(paths.slice(i, i + 6).map(batch));
  const allServed = paths.length > 0 && ok === paths.length;
  checks.push({
    id: "pages",
    label: "Every page loads from Plexo on your real domain",
    status: allServed ? "done" : ok === 0 ? "todo" : "review",
    detail: allServed ? `All ${paths.length} addresses answer from Plexo over HTTPS.` : `${ok} of ${paths.length} addresses answer from Plexo so far${failures[0] ? ` — e.g. ${failures[0].path}: ${failures[0].problem}` : ""}.`,
  });

  if (plan.email) {
    const mxNow = await q(() => resolver.resolveMx(domain), [] as { priority: number; exchange: string }[]);
    const before = plan.email.mx.map((m) => m.exchange.toLowerCase()).sort().join(",");
    const now = mxNow.map((m) => m.exchange.toLowerCase()).sort().join(",");
    checks.push({
      id: "email",
      label: "Email records intact",
      status: before === now ? "done" : "blocked",
      detail: before === now ? `Your ${plan.email.provider} email records are unchanged.` : `Your email (MX) records changed from ${before || "none"} to ${now || "none"} — put the originals back (listed under “Keep exactly as they are”) or email will stop arriving.`,
    });
    if (plan.email.onWebHost) {
      checks.push({ id: "email-host", label: "Email moved off your web host", status: "blocked", detail: "Your mailboxes live at your web host. Move them before cancelling the hosting, or keep the plan for email only." });
    }
  }

  const nsNow = await q(() => resolver.resolveNs(domain), [] as string[]);
  const stillOnHost = plan.dnsHost.tiedToWebHost && nsNow.map((n) => n.toLowerCase()).some((n) => plan.dnsHost.nameservers.includes(n.replace(/\.$/, "")));
  checks.push({
    id: "dns-host",
    label: "DNS no longer depends on your WordPress hosting",
    status: plan.dnsHost.tiedToWebHost ? (stillOnHost ? "blocked" : "done") : "done",
    detail: plan.dnsHost.tiedToWebHost
      ? stillOnHost
        ? `Your DNS is still served by ${plan.dnsHost.name}. Cancelling the hosting now would take your domain offline — move DNS first (step 1).`
        : "Your DNS is now served by a provider that doesn't depend on your old hosting."
      : `Your DNS is at ${plan.dnsHost.name}, separate from your hosting.`,
  });

  const migrationBlocked = report.checklist.filter((c) => c.status === "blocked" && c.id !== "domain");
  checks.push({
    id: "migration",
    label: "Nothing in the migration checklist is blocking",
    status: migrationBlocked.length ? "blocked" : "done",
    detail: migrationBlocked.length ? migrationBlocked.map((c) => c.label).join("; ") : "Content, forms, SEO and payments are all ready.",
  });

  return {
    checkedAt: new Date().toISOString(),
    checks,
    pages: { ok, total: paths.length, failures: failures.slice(0, 20) },
    safeToCancelWordPress: checks.every((c) => c.status === "done"),
  };
}

export function plexoRoutingEndpoint(): string {
  return getRoutingEndpoint();
}
