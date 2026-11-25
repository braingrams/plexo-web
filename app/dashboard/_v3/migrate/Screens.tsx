"use client";

import "./migrate.css";
import Link from "next/link";
import { useState } from "react";
import {
  ArrowLeft, ArrowRight, CheckCircle2, Clock, Copy, ExternalLink, FileText, FormInput, Globe, Image as ImageIcon, Lock, Mail, Menu, Monitor, Newspaper, Pencil, RefreshCw, Rocket, Search, ShieldCheck, ShoppingBag, Smartphone, Link2, LifeBuoy, ListChecks,
} from "lucide-react";
import { Badge, Button, ButtonLink, Card, CardHeader, Input, ProgressBar, SegmentedControl } from "../ui";
import { Disclosure, IssueList, Note, StatCard, Track, VStepper } from "./pieces";
import { estimateMigrationSeconds, formatDuration } from "@/lib/wpMigration/estimate";
import { addressProblem, blogStatus, moveStages, movePercent, planGate, reportIssues, reportSummary, solHref } from "@/lib/wpMigration/moveView";
import { afterCreateHref } from "@/lib/dashboardV3/newSite";
import type { ExistingMigration, JobStatus, DomainRow, Plugin, Preview, Report } from "@/app/dashboard/migrate/wordpress/wizard/types";

const PAGES_DOMAIN = process.env.NEXT_PUBLIC_PAGES_DOMAIN || "plexopages.com";
export const TRACK = ["Find your site", "Look it over", "Moving", "Check it", "Go live"];

const hostOf = (url: string) => {
  try { return new URL(url).host; } catch { return url; }
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const n = (x: number) => x.toLocaleString("en-US");

function Head({ step, title, sub, children }: { step: number; title: React.ReactNode; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <header className="plx-mv__head">
      <Track steps={TRACK} current={step} />
      <div className="plx-rowbetween" style={{ alignItems: "flex-start" }}>
        <div style={{ minWidth: 0, flex: "1 1 360px" }}>
          <h1 className="plx-mv__title">{title}</h1>
          {sub ? <p className="plx-mv__sub">{sub}</p> : null}
        </div>
        {children}
      </div>
    </header>
  );
}

// ── 1. Start ───────────────────────────────────────────────────────────────────

const WHAT_MOVES = [
  { icon: <FileText size={20} />, title: "Pages", body: "Every page, with its layout, colours and fonts." },
  { icon: <Newspaper size={20} />, title: "Blog posts", body: "With their categories, authors and dates." },
  { icon: <ImageIcon size={20} />, title: "Pictures and files", body: "Your whole media library, stored on Plexo." },
  { icon: <Menu size={20} />, title: "Menus", body: "Your navigation, in the same order." },
  { icon: <FormInput size={20} />, title: "Forms", body: "Contact forms keep working and collecting replies." },
  { icon: <ShoppingBag size={20} />, title: "Shop products", body: "Products and prices, if you sell with WooCommerce." },
];

export function StartScreen(props: {
  url: string; onUrl: (v: string) => void; onCheck: (e: React.FormEvent) => void; checking: boolean;
  error: string | null; upgradeNeeded: boolean; existing: ExistingMigration | null; canMove: boolean;
}) {
  const [touched, setTouched] = useState(false);
  const problem = touched ? addressProblem(props.url) : null;
  const gate = planGate(props.canMove);
  const blocked = !props.url.trim() || !!addressProblem(props.url) || !props.canMove;
  return (
    <div className="plx-mv">
      <Head step={0} title="Move your WordPress site to Plexo" sub="Type your website's address and we'll do the heavy lifting. It takes a few minutes and you don't need to know anything technical." />

      {props.existing ? (
        <Note tone="info" title={`You already started moving ${props.existing.siteName ?? "a site"}`} action={<div><ButtonLink size="sm" variant="secondary" href={`/dashboard/migrate/wordpress?site=${props.existing.templateId}&job=${props.existing.id}`} rightIcon={<ArrowRight size={16} />}>Pick up where you left off</ButtonLink></div>} />
      ) : null}

      <div className="plx-mv__cols plx-mv__cols--even">
        <div className="plx-mv__col">
          <Card tone="tint" padding="lg" className="plx-mv__hero">
            <ul className="plx-mv__points">
              <li className="plx-mv__point"><span className="plx-mv__icon"><Copy size={20} aria-hidden /></span><span><b>We copy your pages, blog posts, pictures and menus.</b> Same web addresses, same words.</span></li>
              <li className="plx-mv__point"><span className="plx-mv__icon"><ShieldCheck size={20} aria-hidden /></span><span><b>Your WordPress site stays untouched</b> until you switch your address. Nothing breaks for your visitors.</span></li>
              <li className="plx-mv__point"><span className="plx-mv__icon"><Mail size={20} aria-hidden /></span><span><b>Close the page whenever you like.</b> We keep going and email you when it's done.</span></li>
            </ul>
            <form className="plx-mv__form" onSubmit={props.onCheck} noValidate>
              <Input
                label="Your WordPress website address"
                help="The address people type to visit your site, like yourwebsite.com."
                error={problem ?? undefined}
                placeholder="yourwebsite.com"
                value={props.url}
                onChange={(e) => { props.onUrl(e.target.value); }}
                onBlur={() => setTouched(true)}
                inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoFocus
                disabled={!props.canMove}
              />
              <Button type="submit" size="lg" loading={props.checking} loadingLabel="Looking at your site" disabled={blocked} rightIcon={<ArrowRight size={18} />} className="plx-mv__go">
                Look at my site
              </Button>
            </form>
            {props.error ? (
              <Note tone="bad" title="We couldn't read that site" action={props.upgradeNeeded ? <div><ButtonLink size="sm" variant="secondary" href="/dashboard/settings/subscription?upgrade=STARTER&returnTo=/dashboard/migrate/wordpress">See plans</ButtonLink></div> : undefined}>{props.error}</Note>
            ) : null}
          </Card>

          {gate ? (
            <Card padding="lg">
              <CardHeader title={gate.title} description={gate.body} />
              <ButtonLink href="/dashboard/settings/subscription?upgrade=STARTER&returnTo=/dashboard/migrate/wordpress" rightIcon={<ArrowRight size={16} />}>See plans</ButtonLink>
            </Card>
          ) : null}
        </div>

        <div className="plx-mv__col">
          <Card padding="lg">
            <CardHeader title="How should we read your site?" description="Most people don't need to do anything extra." />
            <div className="plx-stack">
              <div className="plx-opt" data-on="true">
                <div className="plx-opt__top"><Globe size={20} aria-hidden /><h3>Just what visitors can see</h3><Badge tone="success">Recommended</Badge></div>
                <p>Works for almost every site, with nothing to install. This is what we use first.</p>
              </div>
              <div className="plx-opt">
                <div className="plx-opt__top"><Lock size={20} aria-hidden /><h3>Also the private things</h3></div>
                <p>Past form replies, drafts, redirects and your team live inside WordPress where visitors can't see them. To bring those over too, you add a small free helper to WordPress. It only reads, and it never changes your site.</p>
                <p><b>You'll get a short code after your move starts</b> to connect it. You can also do it later.</p>
              </div>
            </div>
          </Card>
          <Card padding="lg">
            <CardHeader title="What comes across" />
            <div className="plx-stack" style={{ gap: 14 }}>
              {WHAT_MOVES.map((f) => (
                <div key={f.title} className="plx-fact" style={{ borderTop: 0, padding: 0 }}>
                  <span className="plx-mv__icon" style={{ background: "var(--plx-tint)" }}>{f.icon}</span>
                  <div className="plx-fact__text"><b>{f.title}</b><span>{f.body}</span></div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ── 2. Look it over ────────────────────────────────────────────────────────────

const OUTCOME_WORDS: Record<Plugin["outcome"], { label: string; tone: "warning" | "success" | "brand" | "neutral" }> = {
  NEEDS_ATTENTION: { label: "Check after the move", tone: "warning" },
  NATIVE: { label: "Plexo does this for you", tone: "success" },
  PRESERVED: { label: "Comes across as it is", tone: "brand" },
  NOT_NEEDED: { label: "Not needed", tone: "neutral" },
};

export function ReviewScreen(props: {
  preview: Preview; wholeSite: boolean; onWholeSite: (v: boolean) => void; owns: boolean; onOwns: (v: boolean) => void;
  needsAup: boolean; aup: boolean; onAup: (v: boolean) => void; starting: boolean; error: string | null; onStart: () => void; onBack: () => void;
}) {
  const { preview } = props;
  const name = preview.siteName || hostOf(preview.origin);
  const minutes = formatDuration(estimateMigrationSeconds({ pages: preview.counts.pages, posts: preview.counts.posts, media: preview.counts.media }));
  const ready = props.owns && (!props.needsAup || props.aup);
  const attention = preview.plugins.filter((p) => p.outcome === "NEEDS_ATTENTION").length;
  return (
    <div className="plx-mv">
      <Head step={1} title={`We found ${name}`} sub="Here's what we'll bring across. Have a quick look, then start whenever you're ready. Nothing changes on WordPress." />
      <div className="plx-mv__cols">
        <div className="plx-mv__col">
          <Card padding="lg">
            <div className="plx-mvrow" style={{ marginBottom: 18, flexWrap: "nowrap" }}>
              <span className="plx-mv__icon" style={{ width: 52, height: 52, background: "var(--plx-tint)", fontWeight: 800, fontSize: 22 }}>{name.charAt(0).toUpperCase()}</span>
              <div style={{ minWidth: 0 }}>
                <b style={{ fontSize: 18 }}>{name}</b>
                <div className="plx-small" style={{ overflowWrap: "anywhere" }}>{hostOf(preview.homeUrl)}{preview.siteDescription ? ` · ${preview.siteDescription}` : ""}</div>
              </div>
            </div>
            <div className="plx-mvstats">
              <StatCard icon={<FileText size={20} />} value={n(preview.counts.pages)} label={preview.counts.pages === 1 ? "page" : "pages"} />
              <StatCard icon={<Newspaper size={20} />} value={n(preview.counts.posts)} label={preview.counts.posts === 1 ? "blog post" : "blog posts"} />
              <StatCard icon={<ImageIcon size={20} />} value={n(preview.counts.media)} label="pictures and files" />
            </div>
            {preview.staticPages.length > 0 ? (
              <p className="plx-small" style={{ marginTop: 14 }}>
                We also found {preview.staticPages.length} page{preview.staticPages.length > 1 ? "s" : ""} that sit next to WordPress ({preview.staticPages.map((p) => new URL(p).pathname).join(", ")}). They come across too.
              </p>
            ) : null}
          </Card>

          {preview.wholeSite ? (
            <Card padding="lg">
              <CardHeader title="Your domain has more than this WordPress folder" description={`In front of WordPress we found ${preview.wholeSite.staticPages.length} other page${preview.wholeSite.staticPages.length > 1 ? "s" : ""} (${preview.wholeSite.staticPages.map((p) => new URL(p).pathname).join(", ")}). What should we move?`} />
              <div className="plx-stack">
                {[
                  { whole: true, title: "The whole site", hint: "WordPress and those pages, working together just like now.", rec: true },
                  { whole: false, title: `Only ${new URL(preview.homeUrl).pathname.replace(/\/+$/, "") || "/"}`, hint: "Just the WordPress part. The other pages stay behind.", rec: false },
                ].map((o) => (
                  <label key={String(o.whole)} className="plx-opt" data-on={props.wholeSite === o.whole} style={{ cursor: "pointer" }}>
                    <span className="plx-opt__top">
                      <input type="radio" name="move-scope" checked={props.wholeSite === o.whole} onChange={() => props.onWholeSite(o.whole)} style={{ width: 20, height: 20, accentColor: "var(--plx-deep)" }} />
                      <h3>{o.title}</h3>{o.rec ? <Badge tone="success">Recommended</Badge> : null}
                    </span>
                    <p>{o.hint}</p>
                  </label>
                ))}
              </div>
            </Card>
          ) : null}

          <Disclosure title="Add-ons on your site" hint={attention ? `${attention} will need a look after the move` : "Nothing here needs you"} defaultOpen={attention > 0}>
            <p className="plx-small" style={{ margin: 0 }}>These are the extras installed in WordPress (called plugins) and what happens to each one.</p>
            {preview.plugins.length === 0 ? <p className="plx-small">No add-ons found.</p> : (
              <div className="plx-facts">
                {preview.plugins.map((p) => (
                  <div className="plx-fact" key={p.slug}>
                    <div className="plx-fact__text"><b>{p.name}</b><span>{p.explanation}</span></div>
                    <Badge tone={OUTCOME_WORDS[p.outcome].tone}>{OUTCOME_WORDS[p.outcome].label}</Badge>
                  </div>
                ))}
              </div>
            )}
          </Disclosure>
        </div>

        <div className="plx-mv__col plx-mv__sticky">
          <Card padding="lg">
            <CardHeader title="Ready when you are" />
            <div className="plx-facts" style={{ marginBottom: 18 }}>
              <div className="plx-fact"><Clock size={20} aria-hidden /><div className="plx-fact__text"><b>Takes {minutes}</b><span>Based on {n(preview.counts.pages + preview.counts.posts)} pages and posts and {n(preview.counts.media)} files.</span></div></div>
              <div className="plx-fact"><Mail size={20} aria-hidden /><div className="plx-fact__text"><b>Close the page any time</b><span>We keep going and email you when it's done.</span></div></div>
              <div className="plx-fact"><ShieldCheck size={20} aria-hidden /><div className="plx-fact__text"><b>WordPress stays as it is</b><span>Nothing changes there until you choose to switch.</span></div></div>
            </div>
            <div className="plx-stack">
              <label className="plx-mvrow" style={{ flexWrap: "nowrap", alignItems: "flex-start", cursor: "pointer" }}>
                <input type="checkbox" checked={props.owns} onChange={(e) => props.onOwns(e.target.checked)} style={{ width: 22, height: 22, marginTop: 1, accentColor: "var(--plx-deep)", flex: "none" }} />
                <span>This is my website, or I have the owner's permission to move it.</span>
              </label>
              {props.needsAup ? (
                <label className="plx-mvrow" style={{ flexWrap: "nowrap", alignItems: "flex-start", cursor: "pointer" }}>
                  <input type="checkbox" checked={props.aup} onChange={(e) => props.onAup(e.target.checked)} style={{ width: 22, height: 22, marginTop: 1, accentColor: "var(--plx-deep)", flex: "none" }} />
                  <span>I agree to Plexo's <Link href="/legal/acceptable-use" target="_blank">Acceptable Use Policy</Link>.</span>
                </label>
              ) : null}
              {props.error ? <Note tone="bad">{props.error}</Note> : null}
              <Button size="lg" fullWidth disabled={!ready} loading={props.starting} loadingLabel="Starting" onClick={props.onStart} rightIcon={<ArrowRight size={18} />}>Start moving my site</Button>
              <Button variant="secondary" fullWidth onClick={props.onBack} leftIcon={<ArrowLeft size={16} />}>Use a different address</Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ── 3. Moving ──────────────────────────────────────────────────────────────────

export function ProgressScreen({ job, siteName, onRetry }: { job: JobStatus; siteName: string; onRetry: () => void }) {
  const paused = job.phase === "PAUSED_ERROR";
  const failed = job.phase === "FAILED";
  const stopped = paused || failed;
  const stages = moveStages(job);
  const percent = Math.floor(movePercent(job));
  const c = job.counts;
  const active = stages.find((s) => s.state === "active");
  return (
    <div className="plx-mv">
      <Head
        step={2}
        title={failed ? "This move stopped" : paused ? "We paused for a moment" : `Moving ${siteName}`}
        sub={failed ? "Nothing was lost and your WordPress site is untouched. You can start a fresh move whenever you like." : paused ? "Trying again picks up exactly where we stopped. Nothing you've already moved is lost." : "Sit back while we copy everything over. Your WordPress site stays exactly as it is."}
      />
      <div className="plx-mv__cols plx-mv__cols--rail">
        <Card padding="lg">
          <CardHeader title="What we're doing" />
          <VStepper stages={stages} />
        </Card>

        <div className="plx-mv__col">
          <Card padding="lg">
            <div className="plx-rowbetween" style={{ alignItems: "flex-end", marginBottom: 16 }}>
              <span className="plx-bigpct" aria-label={`${percent} percent done`}>{percent}%</span>
              {!stopped ? (
                <span className="plx-body" style={{ fontWeight: 700 }}>
                  {typeof job.estimatedSecondsLeft === "number" ? `${cap(formatDuration(job.estimatedSecondsLeft))} left` : "Working out how big your site is…"}
                </span>
              ) : null}
            </div>
            <ProgressBar value={percent} showLabel={false} label={`${percent}% done`} />
            {!stopped && active ? <p className="plx-body" style={{ marginTop: 14, color: "var(--plx-text)", fontWeight: 600 }}>{active.doing}{active.detail ? ` · ${active.detail}` : ""}</p> : null}
          </Card>

          {c ? (
            <div className="plx-mvstats">
              <StatCard icon={<FileText size={20} />} value={<>{n(c.pagesDone)}<small style={{ fontSize: 16, color: "var(--plx-muted)" }}> / {n(c.pages)}</small></>} label="pages built" />
              <StatCard icon={<Newspaper size={20} />} value={<>{n(c.postsDone)}<small style={{ fontSize: 16, color: "var(--plx-muted)" }}> / {n(c.posts)}</small></>} label="blog posts copied" />
              {(c.products ?? 0) > 0 ? <StatCard icon={<ShoppingBag size={20} />} value={<>{n(c.productsDone ?? 0)}<small style={{ fontSize: 16, color: "var(--plx-muted)" }}> / {n(c.products ?? 0)}</small></>} label="products copied" /> : null}
              <StatCard icon={<ImageIcon size={20} />} value={<>{n(c.assetsDone + c.assetsSkipped)}<small style={{ fontSize: 16, color: "var(--plx-muted)" }}> / {n(c.assets)}</small></>} label="pictures copied" />
            </div>
          ) : null}

          {stopped ? (
            <Card padding="lg">
              <div className="plx-stack">
                <Note tone={failed ? "bad" : "warning"} title={failed ? "What happened" : "What we saw"}>{readableError(job.errors[job.errors.length - 1])}</Note>
                <div>
                  <b>What to do</b>
                  <p className="plx-body" style={{ marginTop: 4 }}>
                    {failed ? "Check your WordPress site opens in a browser, then start a new move. If it keeps happening, Ask SOL to take a look." : "This is usually your WordPress host being slow or briefly offline. Tap Try again. If it keeps stopping, wait a few minutes first."}
                  </p>
                </div>
                <div className="plx-mvrow">
                  {paused ? <Button size="lg" onClick={onRetry} leftIcon={<RefreshCw size={18} />}>Try again</Button> : <ButtonLink size="lg" href="/dashboard/migrate/wordpress">Start a new move</ButtonLink>}
                  <ButtonLink variant="secondary" size="lg" href={solHref(`My WordPress move for ${siteName} ${failed ? "stopped" : "paused"}: ${job.errors[job.errors.length - 1] ?? "unknown problem"}. What should I do?`)}>Ask SOL for help</ButtonLink>
                </div>
              </div>
            </Card>
          ) : (
            <Note tone="info" title="You can leave this page">
              We keep going on our side and email you the moment it's done. You'll also see a note at the top of your dashboard. Come back here any time to check how it's going.
            </Note>
          )}
        </div>
      </div>
    </div>
  );
}

/** Technical errors, in words a site owner can act on. */
function readableError(raw: string | undefined): string {
  if (!raw) return "Something went wrong on the way.";
  if (/timeout|timed out|ETIMEDOUT|ECONNRESET|504|502|503/i.test(raw)) return "Your WordPress site took too long to answer, or went offline for a moment.";
  if (/401|403|forbidden|blocked|firewall|cloudflare/i.test(raw)) return "Your WordPress site's security is turning us away. It may block visitors it doesn't recognise.";
  if (/404|not found/i.test(raw)) return "We couldn't find something we expected on your WordPress site.";
  return raw;
}

// ── 4. Check it (the report) ───────────────────────────────────────────────────

/** The new site, in a desktop or phone frame. */
export function SitePreview({ url, srcDoc, shown }: { url: string | null; srcDoc?: string; shown?: string }) {
  const [device, setDevice] = useState<"desktop" | "phone">("desktop");
  const label = shown ?? (url ? hostOf(url) : "");
  return (
    <div className="plx-prev">
      <div className="plx-prev__bar">
        <SegmentedControl<"desktop" | "phone"> label="Preview size" value={device} onChange={setDevice} options={[{ value: "desktop", label: "Computer", icon: <Monitor size={16} aria-hidden /> }, { value: "phone", label: "Phone", icon: <Smartphone size={16} aria-hidden /> }]} />
        {url ? <ButtonLink size="sm" variant="secondary" href={url} target="_blank" rel="noreferrer" rightIcon={<ExternalLink size={16} />}>Open in a new tab</ButtonLink> : null}
      </div>
      <div className="plx-prev__stage">
        <div className="plx-prev__frame" data-device={device}>
          <div className="plx-prev__chrome"><Lock size={12} aria-hidden /><span>{label}</span></div>
          <iframe className="plx-prev__iframe" title="Your new site" src={srcDoc ? undefined : url ?? undefined} srcDoc={srcDoc} loading="lazy" sandbox="allow-scripts allow-same-origin allow-popups" />
        </div>
      </div>
    </div>
  );
}

export function ReportScreen(props: {
  report: Report; siteName: string; templateId: string; preview: DomainRow | undefined; subdomain: string; onSubdomain: (v: string) => void;
  publishing: boolean; publishError: string | null; onPublish: () => void; onContinue: () => void; privateData: React.ReactNode; fullReport: React.ReactNode; previewSrcDoc?: string;
}) {
  const r = props.report;
  const issues = reportIssues(r, props.templateId);
  const sum = reportSummary(r);
  const blog = blogStatus(r);
  const path = (() => { try { return new URL(r.source.homeUrl).pathname; } catch { return "/"; } })();
  const previewUrl = props.preview ? `https://${props.preview.domain}${path}` : null;
  const needs = issues.filter((i) => i.severity === "needs").length;
  return (
    <div className="plx-mv">
      <Head step={3} title={`${props.siteName} is on Plexo`} sub="Everything is copied, at the same web addresses. Look around your new site before you switch over. Your WordPress site is still running.">
        <Button size="lg" onClick={props.onContinue} rightIcon={<ArrowRight size={18} />}>Next: put it on my domain</Button>
      </Head>

      <div className="plx-mv__cols">
        <div className="plx-mv__col">
          <div className="plx-mvstats">
            <StatCard icon={<FileText size={20} />} value={n(sum.pages)} label={sum.pages === 1 ? "page moved" : "pages moved"} />
            <StatCard icon={<Newspaper size={20} />} value={n(sum.posts)} label={sum.posts === 1 ? "blog post" : "blog posts"} />
            <StatCard icon={<ImageIcon size={20} />} value={n(sum.pictures)} label="pictures and files" />
            {sum.products !== null ? <StatCard icon={<ShoppingBag size={20} />} value={n(sum.products)} label="products" /> : null}
            <StatCard icon={<FormInput size={20} />} value={n(sum.forms)} label={sum.forms === 1 ? "form working" : "forms working"} />
            <StatCard icon={<Menu size={20} />} value={sum.menus ? "Yes" : "None"} label="menus carried over" />
          </div>

          <Card padding="lg">
            <CardHeader
              title={issues.length === 0 ? "Nothing needs fixing" : issues.length === 1 ? "One thing needs a look" : `${issues.length} things need a look`}
              description={issues.length === 0 ? undefined : needs > 0 ? "Sort the red ones before you go live. The others can wait." : "None of these stop you going live."}
            />
            {issues.length === 0 ? (
              <div className="plx-allgood">
                <CheckCircle2 size={28} aria-hidden style={{ color: "var(--plx-success)", flex: "none" }} />
                <p className="plx-body" style={{ margin: 0 }}>Everything that matters to your visitors came across. You're ready to go live whenever you are.</p>
              </div>
            ) : <IssueList issues={issues} />}
          </Card>

          <Card padding="lg">
            <CardHeader title="Your blog, links and addresses" />
            <div className="plx-facts">
              <div className="plx-fact"><Newspaper size={20} aria-hidden style={{ flex: "none" }} /><div className="plx-fact__text"><b>Blog</b><span>{blog.line}</span></div>{blog.posts > 0 ? <ButtonLink size="sm" variant="secondary" href={`/dashboard/templates/${props.templateId}/blog`}>Manage blog</ButtonLink> : null}</div>
              <div className="plx-fact"><Link2 size={20} aria-hidden style={{ flex: "none" }} /><div className="plx-fact__text"><b>Old addresses keep working</b><span>Every page kept its web address, so links people saved and your Google results still lead to the right place.</span></div></div>
              <div className="plx-fact"><Search size={20} aria-hidden style={{ flex: "none" }} /><div className="plx-fact__text"><b>Google details kept</b><span>{r.seo.titles} of {r.seo.pagesChecked} pages kept the same title that shows in search results.</span></div></div>
            </div>
          </Card>

          <Disclosure title="Bring over the private things" hint="Past form replies, drafts, redirects and your team (optional)">{props.privateData}</Disclosure>
          <Disclosure title="See the full report" hint="Every page and post, and what happened to each add-on">{props.fullReport}</Disclosure>
        </div>

        <div className="plx-mv__col plx-mv__sticky">
          <Card padding="lg">
            <CardHeader title={props.preview ? "Your new site" : "See your new site"} description={props.preview ? "Click around, and try it on a phone too." : "Pick a free address to preview it. Only people you send it to will know it's there."} action={props.preview ? <ButtonLink size="sm" variant="secondary" leftIcon={<Pencil size={16} />} href={`/dashboard/templates/${props.templateId}`}>Edit</ButtonLink> : undefined} />
            {props.preview || props.previewSrcDoc ? (
              <SitePreview url={previewUrl} srcDoc={props.previewSrcDoc} shown={props.preview?.domain ?? `${props.subdomain}.${PAGES_DOMAIN}`} />
            ) : (
              <div className="plx-stack">
                <div className="plx-mvaddr">
                  <input aria-label="Preview address" value={props.subdomain} onChange={(e) => props.onSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} />
                  <span>.{PAGES_DOMAIN}</span>
                </div>
                {props.publishError ? <Note tone="bad">{props.publishError}</Note> : null}
                <Button size="lg" fullWidth loading={props.publishing} loadingLabel="Getting it ready" disabled={!props.subdomain} onClick={props.onPublish}>Show me my new site</Button>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

// ── 5. Go live + done ──────────────────────────────────────────────────────────

export function GoLiveScreen({ host, onBack, templateId, forceDone, children }: { host: string; onBack: () => void; templateId: string; forceDone?: boolean; children: (onSafe: (safe: boolean) => void) => React.ReactNode }) {
  const [safe, setSafe] = useState(false);
  const done = safe || !!forceDone;
  return (
    <div className="plx-mv">
      {done ? (
        <DoneHero host={host} templateId={templateId} />
      ) : (
        <Head step={4} title={`Put ${host} on Plexo`} sub="The last step: point your domain at Plexo. Your WordPress site keeps serving visitors the whole time, so nobody sees a gap." />
      )}
      <div className="plx-mv__cols">
        <div className="plx-mv__col">{children(setSafe)}</div>
        <div className="plx-mv__col plx-mv__sticky">
          <Card padding="lg">
            <CardHeader title="While you switch" />
            <div className="plx-facts">
              <div className="plx-fact"><Clock size={20} aria-hidden style={{ flex: "none" }} /><div className="plx-fact__text"><b>No gap for visitors</b><span>Until your domain points at Plexo, WordPress keeps answering. After that, Plexo does.</span></div></div>
              <div className="plx-fact"><Link2 size={20} aria-hidden style={{ flex: "none" }} /><div className="plx-fact__text"><b>Same addresses</b><span>Bookmarks, shared links and search results keep working.</span></div></div>
              <div className="plx-fact"><ShieldCheck size={20} aria-hidden style={{ flex: "none" }} /><div className="plx-fact__text"><b>Keep WordPress for now</b><span>Cancel your old hosting only after we tell you the switch is complete.</span></div></div>
            </div>
          </Card>
          <Card tone="tint" padding="lg">
            <CardHeader title="Want us to help?" description="Ask SOL and it will walk you through it, or do the checking for you." />
            <div className="plx-mvrow">
              <ButtonLink variant="secondary" leftIcon={<LifeBuoy size={18} />} href={solHref(`Help me put ${host} on my new Plexo site. Where do I make the change and what do I type?`)}>We'll help you</ButtonLink>
              <Button variant="secondary" onClick={onBack} leftIcon={<ArrowLeft size={16} />}>Back to my new site</Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function DoneHero({ host, templateId }: { host: string; templateId: string }) {
  return (
    <>
      <Card tone="tint" padding="lg">
        <div className="plx-done">
          <span className="plx-done__mark"><CheckCircle2 size={38} aria-hidden /></span>
          <h1 className="plx-mv__title">Your site is on Plexo</h1>
          <p className="plx-mv__sub" style={{ margin: 0 }}>{host} now opens your Plexo site. Every page kept its address. It's safe to cancel your old WordPress hosting.</p>
          <div className="plx-mvrow" style={{ justifyContent: "center", marginTop: 8 }}>
            <ButtonLink size="lg" href={`https://${host}`} target="_blank" rel="noreferrer" rightIcon={<ExternalLink size={18} />}>Visit my site</ButtonLink>
            <ButtonLink size="lg" variant="secondary" href={afterCreateHref()}>Go to my dashboard</ButtonLink>
          </div>
        </div>
      </Card>
      <div>
        <h2 className="plx-card__title" style={{ marginBottom: 12 }}>What to do next</h2>
        <div className="plx-next">
          <Card interactive as="div" padding="md"><NextLink href={solHref(`I just moved ${host} from WordPress. Help me improve my pages.`)} icon={<Rocket size={22} />} title="Edit with SOL" body="Tell SOL what to change and it does it." /></Card>
          <Card interactive as="div" padding="md"><NextLink href={`/dashboard/templates/${templateId}/form-submissions`} icon={<ListChecks size={22} />} title="Set up your forms" body="Choose where form replies are sent." /></Card>
          <Card interactive as="div" padding="md"><NextLink href={`/dashboard/templates/${templateId}`} icon={<Search size={22} />} title="Check your Google details" body="Page titles and descriptions for search." /></Card>
        </div>
      </div>
    </>
  );
}

function NextLink({ href, icon, title, body }: { href: string; icon: React.ReactNode; title: string; body: string }) {
  return (
    <Link href={href} style={{ display: "flex", gap: 14, color: "inherit", textDecoration: "none", alignItems: "flex-start" }}>
      <span className="plx-mv__icon" style={{ background: "var(--plx-tint)" }}>{icon}</span>
      <span className="plx-fact__text"><b>{title}</b><span>{body}</span></span>
    </Link>
  );
}

