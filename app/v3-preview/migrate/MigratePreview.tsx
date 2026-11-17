"use client";

import { GoLiveScreen, ProgressScreen, ReportScreen, ReviewScreen, StartScreen } from "@/app/dashboard/_v3/migrate/Screens";
import { DomainPanel, PrivateDataPanel } from "@/app/dashboard/_v3/migrate/Panels";
import { FullReportV3 } from "@/app/dashboard/_v3/migrate/FullReportV3";
import type { Counts, JobStatus, Preview, Report } from "@/app/dashboard/migrate/wordpress/wizard/types";
import type { CutoverView } from "@/app/dashboard/migrate/wordpress/WordPressMigrationClient";

export const MIGRATE_STATES = ["start", "start-error", "start-free", "review", "progress", "progress-error", "report", "domain", "done"];

const noop = () => {};
const counts: Counts = { pages: 24, pagesDone: 9, pagesFailed: 0, posts: 62, postsDone: 62, postsFailed: 0, assets: 410, assetsDone: 120, assetsFailed: 0, assetsSkipped: 0 };
const job = (o: Partial<JobStatus>): JobStatus => ({ id: "j1", templateId: "t1", sourceUrl: "https://amaskitchen.com", phase: "PAGES", counts, estimatedSecondsLeft: 540, report: null, errors: [], ...o });

const preview: Preview = {
  siteName: "Ama's Kitchen", siteDescription: "Home cooking from Accra", origin: "https://amaskitchen.com", homeUrl: "https://amaskitchen.com/", inSubdirectory: false, staticPages: [],
  counts: { pages: 24, posts: 62, media: 410, categories: 6, tags: 20 }, theme: null,
  plugins: [
    { slug: "yoast", name: "Yoast SEO", outcome: "NATIVE", explanation: "Plexo writes your search titles and descriptions itself." },
    { slug: "cf7", name: "Contact Form 7", outcome: "NATIVE", explanation: "Your contact forms were rebuilt as Plexo forms." },
    { slug: "slider", name: "Revolution Slider", outcome: "NEEDS_ATTENTION", explanation: "The sliding banner on your home page can't be copied exactly. We keep a still version." },
  ],
};

const report: Report = {
  source: { origin: "https://amaskitchen.com", homeUrl: "https://amaskitchen.com/", siteName: "Ama's Kitchen" },
  summary: { pagesCopied: 23, pagesFailed: 1, postsCopied: 62, postsFailed: 0, filesCopied: 398, filesFailed: 2, filesAlreadyMissing: 3, bytesCopied: 84_000_000, formsReconnected: 2 },
  seo: { pagesChecked: 24, titles: 23, descriptions: 20, canonicals: 24, structuredData: 10, robots: 24 },
  pages: [
    { key: "home", kind: "PAGE", title: "Home", sourceUrl: "", newPath: "/", status: "DONE", error: null, seo: { title: true } },
    { key: "about", kind: "PAGE", title: "About Ama", sourceUrl: "", newPath: "/about", status: "DONE", error: null, seo: { title: true } },
    { key: "events", kind: "PAGE", title: "Cooking events", sourceUrl: "", newPath: null, status: "FAILED", error: "timeout", seo: null },
  ],
  forms: [], brokenLinks: [{ from: "/about", href: "/old-menu.pdf", reason: "That file was never on WordPress, so there's nothing to copy." }],
  failedFiles: [{ path: "/wp-content/uploads/2021/hero-large.jpg", reason: "Too large" }, { path: "/wp-content/uploads/2022/menu.pdf", reason: "Timed out" }],
  missingOnSource: [], plugins: preview.plugins,
  checklist: [
    { id: "payments", label: "Connect your payment account", status: "blocked", detail: "Donations and shop orders can't be paid until a payment account is connected." },
    { id: "seo", label: "Check the 3 pages without a search description", status: "review", detail: "Google will make one up. Writing your own usually gets more clicks." },
    { id: "publish", label: "Publish", status: "todo", detail: "" },
  ],
  readyForCutover: true,
};

const SITE_HTML = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font-family:system-ui;background:#fdf6ec;color:#2a1a0a}nav{display:flex;justify-content:space-between;padding:16px 24px;font-weight:700}main{padding:40px 24px}h1{font-size:34px;margin:0 0 10px}.b{display:inline-block;margin-top:14px;padding:12px 18px;background:#2a1a0a;color:#fdf6ec;border-radius:10px}.g{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-top:28px}.g i{height:90px;background:#f0d9b5;border-radius:12px}</style></head><body><nav><span>Ama's Kitchen</span><span>Menu &middot; Blog &middot; Contact</span></nav><main><h1>Home cooking, made with love</h1><p>Jollof, kelewele and everything in between.</p><span class="b">Order now</span><div class="g"><i></i><i></i><i></i></div></main></body></html>`;

const cutover: CutoverView = {
  plan: {
    domain: "amaskitchen.com", wwwDomain: "www.amaskitchen.com",
    dnsHost: { name: "GoDaddy", tiedToWebHost: false, apexHostnameSupport: "alias", apexRecordType: "A" },
    email: { provider: "Google Workspace", onWebHost: false },
    keep: [{ name: "@", type: "MX", value: "aspmx.l.google.com", priority: 1, why: "Your email" }],
    plexo: [{ name: "@", type: "A", value: "76.76.21.21", why: "Points your domain at Plexo" }, { name: "www", type: "CNAME", value: "cname.plexopages.com", why: "Points www at Plexo" }],
    zoneFile: "", steps: ["Sign in to GoDaddy and open My Products, then your domain's DNS settings.", "Change the A record for @ to 76.76.21.21 and the www CNAME to cname.plexopages.com.", "Leave every MX and TXT line as it is so your email keeps working."], warnings: [],
  },
  connected: [{ domain: "amaskitchen.com", ready: false }, { domain: "www.amaskitchen.com", ready: false }],
  verification: {
    checks: [
      { id: "dns", label: "Your domain points at Plexo", status: "done", detail: "Both amaskitchen.com and www.amaskitchen.com answer from Plexo." },
      { id: "pages", label: "Every page opens", status: "review", detail: "23 of 24 pages open. /events is still being copied." },
      { id: "email", label: "Your email is untouched", status: "done", detail: "Google Workspace email settings are intact." },
      { id: "cert", label: "The padlock (secure connection)", status: "todo", detail: "Waiting for your domain to finish switching." },
    ],
    pages: { ok: 23, total: 24 }, safeToCancelWordPress: false, checkedAt: "now",
  },
};
const cutoverDone: CutoverView = { ...cutover, verification: { ...cutover.verification!, checks: cutover.verification!.checks.map((c) => ({ ...c, status: "done" as const })), pages: { ok: 24, total: 24 }, safeToCancelWordPress: true } };

const connector = { status: "WAITING" as const, summary: null, error: null, code: "plx_9fK2-MQx7-vB31-aZ0p" };

export function MigratePreview({ state }: { state: string }) {
  switch (state) {
    case "start": return <StartScreen url="" onUrl={noop} onCheck={noop} checking={false} error={null} upgradeNeeded={false} existing={null} canMove />;
    case "start-error": return <StartScreen url="amaskitchen" onUrl={noop} onCheck={noop} checking={false} error="We couldn't find a WordPress site at that address. Check for typos, and make sure the site opens in your browser." upgradeNeeded={false} existing={{ id: "j0", templateId: "t0", siteName: "Ama's Kitchen", phase: "POSTS" }} canMove />;
    case "start-free": return <StartScreen url="" onUrl={noop} onCheck={noop} checking={false} error={null} upgradeNeeded existing={null} canMove={false} />;
    case "review": return <ReviewScreen preview={preview} wholeSite onWholeSite={noop} owns={false} onOwns={noop} needsAup={false} aup={false} onAup={noop} starting={false} error={null} onStart={noop} onBack={noop} />;
    case "progress": return <ProgressScreen job={job({})} siteName="Ama's Kitchen" onRetry={noop} />;
    case "progress-error": return <ProgressScreen job={job({ phase: "PAUSED_ERROR", pausedIn: "ASSETS", counts: { ...counts, pagesDone: 24, assetsDone: 233 }, errors: ["ETIMEDOUT: request to https://amaskitchen.com/wp-content/uploads timed out"] })} siteName="Ama's Kitchen" onRetry={noop} />;
    case "report":
      return <ReportScreen report={report} siteName="Ama's Kitchen" templateId="t1" preview={{ domain: "amaskitchen.plexopages.com", type: "SUBDOMAIN", active: true, dnsVerified: true }} subdomain="amaskitchen" onSubdomain={noop} publishing={false} publishError={null} onPublish={noop} onContinue={noop} previewSrcDoc={SITE_HTML} privateData={<PrivateDataPanel templateId="t1" jobId="j1" fixture={{ connector, extras: null }} />} fullReport={<FullReportV3 report={report} templateId="t1" />} />;
    case "domain":
      return <GoLiveScreen host="amaskitchen.com" templateId="t1" onBack={noop}>{(onSafe) => <DomainPanel templateId="t1" jobId="j1" fixture={cutover} onSafe={onSafe} />}</GoLiveScreen>;
    case "done":
      return <GoLiveScreen host="amaskitchen.com" templateId="t1" onBack={noop} forceDone>{(onSafe) => <DomainPanel templateId="t1" jobId="j1" fixture={cutoverDone} onSafe={onSafe} />}</GoLiveScreen>;
    default: return null;
  }
}
