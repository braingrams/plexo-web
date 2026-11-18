"use client";

import Link from "next/link";
import {
  AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, Clock, Copy, ExternalLink, FileText, FormInput, Globe, Image as ImageIcon, Link2, Lock, Mail, Newspaper, PartyPopper, Pencil, RefreshCw, Rocket, Search, ShieldCheck, ShoppingBag,
} from "lucide-react";

import { estimateMigrationSeconds, formatDuration } from "@/lib/wpMigration/estimate";
import { AsideCard, AsideItem, BigStat, Callout, Disclosure, Panel, PrimaryButton, ProgressBar, SecondaryButton, StepShell, WIZARD_STEPS, secondaryButtonStyle, text, tone } from "./ui";
import type { ChecklistItem, DomainRow, ExistingMigration, JobStatus, Outcome, Plugin, Preview, Report } from "./types";

// The five screens of "Move from WordPress". Each takes plain data and callbacks — the
// fetching, polling and starting live in WordPressMigrationClient — so every screen says one
// thing, asks for at most one decision, and has one obvious button.

const PAGES_DOMAIN = process.env.NEXT_PUBLIC_PAGES_DOMAIN || "plexopages.com";

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const inputStyle: React.CSSProperties = {
  flex: 1, minWidth: 0, fontSize: 16, fontFamily: "inherit", color: "var(--text-main)", background: "transparent", border: "none", outline: "none", padding: "14px 4px",
};

// ── 1. Find your site ───────────────────────────────────────────────────────────

const NEXT_STEP_HINT = [
  "see what we found and what happens to each plugin",
  "we copy everything while you get on with your day",
  "look around your new site and sort out anything flagged",
  "point your domain at Plexo, with no gap for visitors",
];

const BROUGHT_ACROSS = [
  { icon: <FileText size={18} />, title: "Pages and design", body: "Your layout, menus, fonts and colours, page by page." },
  { icon: <Newspaper size={18} />, title: "Blog posts", body: "Every post with its categories, tags, authors and dates." },
  { icon: <ImageIcon size={18} />, title: "Images and files", body: "Your media library, PDFs and downloads, re-hosted on Plexo." },
  { icon: <FormInput size={18} />, title: "Forms", body: "Contact and sign-up forms keep working and collecting replies." },
  { icon: <ShoppingBag size={18} />, title: "Shop products", body: "If you sell with WooCommerce, products and prices land in Commerce." },
  { icon: <Search size={18} />, title: "Search settings", body: "Page titles and descriptions, so Google sees the same site." },
];

export function FindSiteStep(props: {
  url: string;
  onUrl: (value: string) => void;
  onCheck: (e: React.FormEvent) => void;
  checking: boolean;
  error: string | null;
  upgradeNeeded: boolean;
  existing: ExistingMigration | null;
}) {
  return (
    <StepShell
      icon={<Globe size={24} />}
      title="Let's move your WordPress site to Plexo"
      subtitle="Type your website's address and we'll take a look. This only reads your site — nothing on WordPress changes, and your visitors won't notice a thing."
      aside={
        <>
          <AsideCard title="Why it's safe">
            <AsideItem icon={<Copy size={18} />} title="We only copy">Your WordPress site keeps running, untouched, until you decide to switch.</AsideItem>
            <AsideItem icon={<Link2 size={18} />} title="Same web addresses">Every page keeps its address, so links and your search ranking stay put.</AsideItem>
            <AsideItem icon={<Clock size={18} />} title="Walk away while it works">Most sites move in minutes. Close the tab — we&rsquo;ll email you when it&rsquo;s done.</AsideItem>
          </AsideCard>
          <AsideCard title="What happens next">
            {WIZARD_STEPS.slice(1).map((label, i) => (
              <div key={label} style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "var(--brand)", width: 14, flexShrink: 0 }}>{i + 2}</span>
                <span style={{ fontSize: 13.5, color: "var(--text-main)" }}>
                  <strong style={{ fontWeight: 650 }}>{label}</strong>
                  <span style={{ color: "var(--text-muted)" }}> — {NEXT_STEP_HINT[i]}</span>
                </span>
              </div>
            ))}
          </AsideCard>
        </>
      }
    >
      {props.existing && (
        <Callout kind="info" icon={<RefreshCw size={18} />} title={`You already started moving ${props.existing.siteName ?? "a site"}`}>
          <Link href={`/dashboard/migrate/wordpress?site=${props.existing.templateId}&job=${props.existing.id}`} style={{ color: "var(--brand)", fontWeight: 650, textDecoration: "none" }}>
            Pick up where you left off →
          </Link>
        </Callout>
      )}

      <form onSubmit={props.onCheck}>
        <Panel style={{ padding: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 8, flex: "1 1 260px", minWidth: 0, paddingLeft: 12 }}>
              <Search size={18} color="var(--text-faint)" />
              <input
                value={props.url}
                onChange={(e) => props.onUrl(e.target.value)}
                placeholder="yourwebsite.com"
                autoFocus
                inputMode="url"
                autoCapitalize="none"
                spellCheck={false}
                aria-label="Your WordPress site's address"
                style={inputStyle}
              />
            </span>
            <PrimaryButton type="submit" disabled={props.checking || !props.url.trim()}>
              {props.checking ? "Looking at your site…" : <>Find my site <ArrowRight size={16} /></>}
            </PrimaryButton>
          </div>
        </Panel>
      </form>

      {props.error && (
        <Callout kind="bad" icon={<AlertTriangle size={18} />} title="We couldn't read that site">
          {props.error}
          {props.upgradeNeeded && (
            <div style={{ marginTop: 10 }}>
              <Link href="/dashboard/settings/subscription?upgrade=STARTER&returnTo=/dashboard/migrate/wordpress" style={{ ...secondaryButtonStyle, padding: "8px 14px" }}>See plans →</Link>
            </div>
          )}
        </Callout>
      )}

      <div>
        <p style={{ margin: "8px 0 12px", fontSize: 12, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-faint)" }}>What comes across</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
          {BROUGHT_ACROSS.map((f) => (
            <div key={f.title} style={{ display: "flex", gap: 12, padding: 16, borderRadius: 14, border: "1px solid var(--surface-border)", background: "var(--surface)" }}>
              <span style={{ color: "var(--brand)", flexShrink: 0, marginTop: 1 }}>{f.icon}</span>
              <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                <span style={{ fontSize: 14, fontWeight: 650, color: "var(--text-main)" }}>{f.title}</span>
                <span style={text.small}>{f.body}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </StepShell>
  );
}

// ── 2. Review ───────────────────────────────────────────────────────────────────

const OUTCOME_LABEL: Record<Outcome, { label: string; color: string }> = {
  NEEDS_ATTENTION: { label: "Worth a look", color: tone.warn },
  NATIVE: { label: "Replaced by Plexo", color: tone.good },
  PRESERVED: { label: "Comes across as it is", color: "var(--brand)" },
  NOT_NEEDED: { label: "Not needed on Plexo", color: "var(--text-faint)" },
};

export function PluginList({ plugins }: { plugins: Plugin[] }) {
  const order: Outcome[] = ["NEEDS_ATTENTION", "NATIVE", "PRESERVED", "NOT_NEEDED"];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {order.map((outcome) => {
        const list = plugins.filter((p) => p.outcome === outcome);
        if (list.length === 0) return null;
        return (
          <div key={outcome}>
            <p style={{ margin: "0 0 8px", fontSize: 12, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: OUTCOME_LABEL[outcome].color }}>
              {OUTCOME_LABEL[outcome].label} · {list.length}
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {list.map((p) => (
                <div key={p.slug}>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--text-main)" }}>{p.name}</p>
                  <p style={text.small}>{p.explanation}</p>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function pluginSummary(plugins: Plugin[]): string {
  const n = (o: Outcome) => plugins.filter((p) => p.outcome === o).length;
  const parts = [
    n("NATIVE") && `${n("NATIVE")} replaced by Plexo`,
    n("PRESERVED") && `${n("PRESERVED")} come across as they are`,
    n("NOT_NEEDED") && `${n("NOT_NEEDED")} not needed`,
    n("NEEDS_ATTENTION") && `${n("NEEDS_ATTENTION")} worth a look`,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "No plugins to worry about";
}

export function ReviewStep(props: {
  preview: Preview;
  /** Only used when the preview offers the whole site: true moves everything, false just the folder. */
  wholeSite: boolean;
  onWholeSite: (value: boolean) => void;
  owns: boolean;
  onOwns: (value: boolean) => void;
  needsAup: boolean;
  aup: boolean;
  onAup: (value: boolean) => void;
  starting: boolean;
  error: string | null;
  onStart: () => void;
  onBack: () => void;
}) {
  const { preview } = props;
  const name = preview.siteName || hostOf(preview.origin);
  const attention = preview.plugins.filter((p) => p.outcome === "NEEDS_ATTENTION").length;
  const minutes = formatDuration(estimateMigrationSeconds({ pages: preview.counts.pages, posts: preview.counts.posts, media: preview.counts.media }));
  const ready = props.owns && (!props.needsAup || props.aup) && !props.starting;

  return (
    <StepShell
      icon={<CheckCircle2 size={24} />}
      title={`We found ${name}`}
      subtitle="Here's everything we'll bring across. Take a quick look, then start whenever you're ready."
      aside={
        <AsideCard title="When you start">
          <AsideItem icon={<Clock size={18} />} title={`Takes about ${minutes}`}>Based on {preview.counts.pages + preview.counts.posts} pages and posts and {preview.counts.media} files.</AsideItem>
          <AsideItem icon={<Mail size={18} />} title="Close the tab any time">We keep going on our side and email you the moment it&rsquo;s done.</AsideItem>
          <AsideItem icon={<ShieldCheck size={18} />} title="WordPress stays as it is">Nothing changes there until you choose to switch, at the very end.</AsideItem>
        </AsideCard>
      }
    >
      <Panel>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
          <span style={{ width: 44, height: 44, borderRadius: 12, display: "grid", placeItems: "center", background: "rgba(var(--brand-rgb),0.1)", color: "var(--brand)", fontWeight: 750, fontSize: 18 }}>
            {name.charAt(0).toUpperCase()}
          </span>
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "var(--text-main)" }}>{name}</p>
            <p style={{ ...text.small, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{hostOf(preview.homeUrl)}{preview.siteDescription ? ` · ${preview.siteDescription}` : ""}</p>
          </div>
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <BigStat value={preview.counts.pages} label={preview.counts.pages === 1 ? "page" : "pages"} />
          <BigStat value={preview.counts.posts} label={preview.counts.posts === 1 ? "blog post" : "blog posts"} />
          <BigStat value={preview.counts.media} label="images & files" />
        </div>
        {preview.staticPages.length > 0 && (
          <p style={{ ...text.small, marginTop: 14 }}>
            We also found {preview.staticPages.length} page{preview.staticPages.length > 1 ? "s" : ""} that sit alongside WordPress ({preview.staticPages.map((p) => new URL(p).pathname).join(", ")}) — they come across too.
          </p>
        )}
      </Panel>

      {preview.wholeSite && (
        <Panel style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "var(--text-main)" }}>Your domain has more than this WordPress folder</p>
          <p style={{ ...text.small, margin: 0 }}>
            In front of WordPress we found {preview.wholeSite.staticPages.length} other page{preview.wholeSite.staticPages.length > 1 ? "s" : ""} ({preview.wholeSite.staticPages.map((p) => new URL(p).pathname).join(", ")}). What should we move?
          </p>
          {[
            { whole: true, title: "The whole site", hint: "WordPress and those pages, working together exactly as they do now." },
            { whole: false, title: `Only ${new URL(preview.homeUrl).pathname.replace(/\/+$/, "")}`, hint: "Just the WordPress site. The other pages stay behind." },
          ].map((o) => (
            <label key={String(o.whole)} style={{ display: "flex", gap: 12, alignItems: "flex-start", cursor: "pointer" }}>
              <input type="radio" name="move-scope" checked={props.wholeSite === o.whole} onChange={() => props.onWholeSite(o.whole)} style={{ width: 18, height: 18, marginTop: 2, accentColor: "var(--brand)" }} />
              <span style={{ fontSize: 14, color: "var(--text-main)", lineHeight: 1.5 }}>
                <strong>{o.title}</strong>{o.whole ? " (recommended)" : ""}<br /><span style={text.small}>{o.hint}</span>
              </span>
            </label>
          ))}
        </Panel>
      )}

      <Disclosure title="Your plugins" hint={pluginSummary(preview.plugins)} defaultOpen={attention > 0}>
        <p style={{ ...text.small, marginBottom: 16 }}>Here&rsquo;s what happens to each one. You&rsquo;ll get a simple checklist for anything that needs you at the end.</p>
        <PluginList plugins={preview.plugins} />
      </Disclosure>

      <Panel style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <label style={{ display: "flex", gap: 12, alignItems: "flex-start", cursor: "pointer" }}>
          <input type="checkbox" checked={props.owns} onChange={(e) => props.onOwns(e.target.checked)} style={{ width: 18, height: 18, marginTop: 2, accentColor: "var(--brand)" }} />
          <span style={{ fontSize: 14, color: "var(--text-main)", lineHeight: 1.5 }}>This is my website, or I have the owner&rsquo;s permission to move it.</span>
        </label>
        {props.needsAup && (
          <label style={{ display: "flex", gap: 12, alignItems: "flex-start", cursor: "pointer" }}>
            <input type="checkbox" checked={props.aup} onChange={(e) => props.onAup(e.target.checked)} style={{ width: 18, height: 18, marginTop: 2, accentColor: "var(--brand)" }} />
            <span style={{ fontSize: 14, color: "var(--text-main)", lineHeight: 1.5 }}>
              I agree to Plexo&rsquo;s <Link href="/legal/acceptable-use" target="_blank" style={{ color: "var(--brand)" }}>Acceptable Use Policy</Link>.
            </span>
          </label>
        )}
        {props.error && <Callout kind="bad" icon={<AlertTriangle size={18} />}>{props.error}</Callout>}
      </Panel>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <SecondaryButton onClick={props.onBack}><ArrowLeft size={15} /> Use a different address</SecondaryButton>
        <PrimaryButton disabled={!ready} onClick={props.onStart}>
          {props.starting ? "Starting…" : <>Start moving my site <ArrowRight size={16} /></>}
        </PrimaryButton>
      </div>
    </StepShell>
  );
}

// ── 3. Moving ───────────────────────────────────────────────────────────────────

const PHASES: { phase: string; doing: string; done: string; weight: number }[] = [
  { phase: "PLANNING", doing: "Reading your WordPress site", done: "Read your site", weight: 5 },
  { phase: "POSTS", doing: "Moving your blog posts", done: "Blog posts moved", weight: 25 },
  { phase: "PRODUCTS", doing: "Moving your shop's products", done: "Products moved", weight: 10 },
  { phase: "PAGES", doing: "Copying your pages and design", done: "Pages and design copied", weight: 25 },
  { phase: "ASSETS", doing: "Copying images, fonts and files", done: "Images and files copied", weight: 30 },
  { phase: "FINALIZING", doing: "Checking every link and search setting", done: "Everything checked", weight: 5 },
];

function phaseProgress(phase: string, c: JobStatus["counts"]): number {
  if (!c) return 0;
  const frac = (done: number, total: number) => (total > 0 ? Math.min(1, done / total) : 0);
  if (phase === "POSTS") return frac(c.postsDone + c.postsFailed, c.posts);
  if (phase === "PRODUCTS") return frac((c.productsDone ?? 0) + (c.productsSkipped ?? 0) + (c.productsFailed ?? 0), c.products ?? 0);
  if (phase === "PAGES") return frac(c.pagesDone + c.pagesFailed, c.pages);
  if (phase === "ASSETS") return frac(c.assetsDone + c.assetsFailed + c.assetsSkipped, c.assets);
  return 0.5;
}

/** How far along the whole migration is, 0–100, from its phase and that phase's counts. */
export function overallPercent(job: JobStatus): number {
  if (job.phase === "COMPLETED") return 100;
  const phase = job.phase === "PAUSED_ERROR" ? job.pausedIn ?? "PLANNING" : job.phase;
  const phases = PHASES.filter((p) => p.phase !== "PRODUCTS" || (job.counts?.products ?? 0) > 0);
  const total = phases.reduce((s, p) => s + p.weight, 0);
  const idx = phases.findIndex((p) => p.phase === phase);
  if (idx < 0) return 1;
  const before = phases.slice(0, idx).reduce((s, p) => s + p.weight, 0);
  return ((before + phases[idx].weight * phaseProgress(phase, job.counts)) / total) * 100;
}

function phaseDetail(phase: string, c: JobStatus["counts"]): string {
  if (!c) return "";
  if (phase === "POSTS" && c.posts) return `${c.postsDone} of ${c.posts}`;
  if (phase === "PRODUCTS" && c.products) return `${(c.productsDone ?? 0) + (c.productsSkipped ?? 0) + (c.productsFailed ?? 0)} of ${c.products}`;
  if (phase === "PAGES" && c.pages) return `${c.pagesDone} of ${c.pages}`;
  if (phase === "ASSETS" && c.assets) return `${c.assetsDone + c.assetsFailed + c.assetsSkipped} of ${c.assets}`;
  return "";
}

export function MovingStep({ job, siteName, onRetry }: { job: JobStatus; siteName: string; onRetry: () => void }) {
  const paused = job.phase === "PAUSED_ERROR";
  const failed = job.phase === "FAILED";
  const current = paused ? job.pausedIn ?? "PLANNING" : job.phase === "PENDING" ? "PLANNING" : job.phase;
  const phases = PHASES.filter((p) => p.phase !== "PRODUCTS" || (job.counts?.products ?? 0) > 0);
  const idx = Math.max(0, phases.findIndex((p) => p.phase === current));
  const percent = overallPercent(job);
  const now = phases[idx];
  const detail = phaseDetail(now?.phase ?? "", job.counts);

  return (
    <StepShell
      icon={<Rocket size={24} />}
      title={failed ? "This move stopped" : paused ? "We've paused for a moment" : `Moving ${siteName}…`}
      subtitle={
        failed ? "Nothing was lost and your WordPress site is untouched. You can start a fresh move whenever you like."
        : paused ? "Usually your WordPress host was slow or briefly offline. Trying again picks up exactly where we stopped."
        : "Sit back — we're copying everything over. Your WordPress site stays exactly as it is."
      }
      aside={
        <AsideCard title="Progress">
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {phases.map((p, i) => {
                const state = i < idx ? "done" : i === idx && !paused && !failed ? "active" : i === idx ? "stopped" : "todo";
                return (
                  <div key={p.phase} style={{ display: "flex", alignItems: "center", gap: 12, opacity: state === "todo" ? 0.45 : 1 }}>
                    <span
                      style={{
                        width: 22, height: 22, borderRadius: 999, flexShrink: 0, display: "grid", placeItems: "center",
                        background: state === "done" ? tone.good : "transparent",
                        border: state === "done" ? "none" : `2px solid ${state === "active" ? "var(--brand)" : state === "stopped" ? tone.warn : "var(--surface-border)"}`,
                        color: "#fff",
                      }}
                    >
                      {state === "done" && <CheckCircle2 size={14} />}
                      {state === "active" && <span style={{ width: 8, height: 8, borderRadius: 999, background: "var(--brand)", animation: "wiz-pulse 1.4s ease-in-out infinite" }} />}
                    </span>
                    <span style={{ fontSize: 14, color: "var(--text-main)", fontWeight: state === "active" ? 650 : 500 }}>{state === "done" ? p.done : p.doing}</span>
                  </div>
                );
              })}
              <style>{`@keyframes wiz-pulse { 0%,100% { opacity: 0.35; transform: scale(0.8); } 50% { opacity: 1; transform: scale(1); } }`}</style>
            </div>
        </AsideCard>
      }
    >
      <Panel style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
          <span style={{ fontSize: 40, fontWeight: 750, letterSpacing: "-0.03em", color: "var(--text-main)", fontVariantNumeric: "tabular-nums" }}>{Math.floor(percent)}%</span>
          {!paused && !failed && (
            <span style={{ ...text.small, fontSize: 13.5 }}>
              {typeof job.estimatedSecondsLeft === "number" ? `${capitalize(formatDuration(job.estimatedSecondsLeft))} left` : "Working out how big your site is…"}
            </span>
          )}
        </div>
        <ProgressBar percent={percent} paused={paused || failed} />
        {!paused && !failed && now && (
          <p style={{ margin: 0, fontSize: 15, color: "var(--text-main)", fontWeight: 600 }}>
            {now.doing}…{detail && <span style={{ fontWeight: 500, color: "var(--text-muted)" }}> {detail}</span>}
          </p>
        )}
      </Panel>

      {job.counts && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <BigStat value={`${job.counts.pagesDone} of ${job.counts.pages}`} label="pages copied" />
          <BigStat value={`${job.counts.postsDone} of ${job.counts.posts}`} label="blog posts moved" />
          {(job.counts.products ?? 0) > 0 && <BigStat value={`${job.counts.productsDone ?? 0} of ${job.counts.products}`} label="products moved" />}
          <BigStat value={`${job.counts.assetsDone + job.counts.assetsSkipped} of ${job.counts.assets}`} label="images & files copied" />
        </div>
      )}

      {(paused || failed) && (
        <Callout kind="warn" icon={<AlertTriangle size={18} />} title={failed ? "What happened" : "What we saw"}>
          {job.errors[job.errors.length - 1] ?? "Something went wrong on the way."}
        </Callout>
      )}

      {paused ? (
        <div><PrimaryButton onClick={onRetry}><RefreshCw size={16} /> Try again</PrimaryButton></div>
      ) : failed ? (
        <div><Link href="/dashboard/migrate/wordpress" style={{ ...secondaryButtonStyle, padding: "12px 20px" }}>Start a new move</Link></div>
      ) : (
        <Callout kind="info" icon={<Lock size={18} />} title="You can close this page">
          We keep going on our side and email you the moment it&rsquo;s done. Come back here any time to see how it&rsquo;s going.
        </Callout>
      )}
    </StepShell>
  );
}

// ── 4. Check your new site ──────────────────────────────────────────────────────

/** The report's checklist minus what's already done, in the order someone would tackle it. */
function openItems(checklist: ChecklistItem[]): ChecklistItem[] {
  const rank = { blocked: 0, review: 1, todo: 2, done: 3 } as const;
  return checklist.filter((c) => c.status !== "done" && c.id !== "publish" && c.id !== "domain").sort((a, b) => rank[a.status] - rank[b.status]);
}

export function CheckStep(props: {
  report: Report;
  siteName: string;
  templateId: string;
  preview: DomainRow | undefined;
  subdomain: string;
  onSubdomain: (value: string) => void;
  publishing: boolean;
  publishError: string | null;
  onPublish: () => void;
  onContinue: () => void;
  /** The optional "bring over form entries, donations, drafts and your team" card. */
  privateData: React.ReactNode;
  /** The full report: every page, plugin and anything worth a look. */
  fullReport: React.ReactNode;
}) {
  const r = props.report;
  const todo = openItems(r.checklist);
  const previewUrl = props.preview ? `https://${props.preview.domain}${new URL(r.source.homeUrl).pathname}` : null;

  return (
    <StepShell
      icon={<PartyPopper size={24} />}
      title={`${props.siteName} is on Plexo`}
      subtitle="Everything has been copied, at the same web addresses. Have a look around your new site before you switch over — your WordPress site is still running."
      aside={
        <AsideCard title="What moved">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <BigStat value={r.summary.pagesCopied} label="pages" />
            <BigStat value={r.summary.postsCopied} label="blog posts" />
            {r.summary.productsMoved != null && <BigStat value={r.summary.productsMoved} label="products" />}
            <BigStat value={r.summary.filesCopied} label="images & files" />
          </div>
          <Link href={`/dashboard/templates/${props.templateId}`} style={{ ...secondaryButtonStyle, justifyContent: "center" }}><Pencil size={14} /> Edit my pages</Link>
        </AsideCard>
      }
    >

      <Panel style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <p style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "var(--text-main)" }}>{props.preview ? "Your new site is ready to see" : "See your new site"}</p>
          <p style={text.muted}>
            {props.preview
              ? `It's live at ${props.preview.domain} — open it next to your WordPress site and click around.`
              : "Pick a free preview address. Only people you send it to will know it's there."}
          </p>
        </div>
        {props.preview ? (
          <div><a href={previewUrl!} target="_blank" rel="noreferrer" style={{ ...secondaryButtonStyle, padding: "12px 18px" }}>Open my new site <ExternalLink size={15} /></a></div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", flex: "1 1 280px", minWidth: 0, border: "1px solid var(--surface-border)", borderRadius: 12, padding: "0 14px", background: "rgba(var(--brand-rgb),0.03)" }}>
                <input
                  value={props.subdomain}
                  onChange={(e) => props.onSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                  aria-label="Preview address"
                  style={{ ...inputStyle, fontSize: 15, padding: "12px 0" }}
                />
                <span style={{ fontSize: 15, color: "var(--text-muted)", whiteSpace: "nowrap" }}>.{PAGES_DOMAIN}</span>
              </div>
              <PrimaryButton size="md" disabled={props.publishing || !props.subdomain} onClick={props.onPublish}>
                {props.publishing ? "Publishing…" : "Show me my site"}
              </PrimaryButton>
            </div>
            {props.publishError && <Callout kind="bad" icon={<AlertTriangle size={18} />}>{props.publishError}</Callout>}
          </>
        )}
      </Panel>

      {todo.length > 0 ? (
        <Panel style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <p style={{ margin: "0 0 10px", fontSize: 17, fontWeight: 700, color: "var(--text-main)" }}>
            {todo.length === 1 ? "One thing to sort out" : `${todo.length} things to sort out`}
          </p>
          {todo.map((item) => (
            <div key={item.id} style={{ display: "flex", gap: 12, padding: "12px 0", borderTop: "1px solid var(--surface-border)" }}>
              <AlertTriangle size={18} color={item.status === "blocked" ? tone.bad : tone.warn} style={{ flexShrink: 0, marginTop: 2 }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <p style={{ margin: 0, fontSize: 14.5, fontWeight: 650, color: "var(--text-main)" }}>{item.label}</p>
                <p style={text.small}>{item.detail}</p>
                <ChecklistAction id={item.id} done={false} templateId={props.templateId} />
              </div>
            </div>
          ))}
        </Panel>
      ) : (
        <Callout kind="good" icon={<CheckCircle2 size={18} />} title="Nothing needs fixing">
          Everything that matters to your visitors came across. You&rsquo;re ready to go live whenever you are.
        </Callout>
      )}

      <Disclosure title="Bring over private information (optional)" hint="Past form entries, donations, drafts, redirects and your team — things WordPress keeps behind the scenes.">
        {props.privateData}
      </Disclosure>

      <Disclosure title="See the full report" hint={`Every page and post, what happened to each plugin, and ${r.seo.titles} of ${r.seo.pagesChecked} pages with matching search settings`}>
        {props.fullReport}
      </Disclosure>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <PrimaryButton onClick={props.onContinue}>Next: go live <ArrowRight size={16} /></PrimaryButton>
      </div>
    </StepShell>
  );
}

function ChecklistAction({ id, done, templateId }: { id: string; done: boolean; templateId: string }) {
  const link = (href: string, label: string) => (
    <Link href={href} style={{ ...secondaryButtonStyle, padding: "7px 12px", fontSize: 13, marginTop: 10 }}>{label}</Link>
  );
  if (id === "payments") return link(done ? `/dashboard/commerce/${templateId}/donations` : `/dashboard/commerce/${templateId}/settings/payments`, done ? "Open donations →" : "Connect payments →");
  if (id === "payments-other") return link(`/dashboard/commerce/${templateId}`, "Open Commerce →");
  if (id === "team-access") return link("/dashboard/settings/team", "Invite your team →");
  return null;
}

// ── 5. Go live ──────────────────────────────────────────────────────────────────

export function GoLiveStep({ host, onBack, children }: { host: string; onBack: () => void; children: React.ReactNode }) {
  return (
    <StepShell
      icon={<Globe size={24} />}
      title={`Put ${host} on Plexo`}
      subtitle="The last step: point your domain at Plexo. Your WordPress site keeps serving visitors the whole time, and nobody sees a gap — when it switches, they simply get your Plexo site at the same addresses."
      aside={
        <AsideCard title="While you switch">
          <AsideItem icon={<Clock size={18} />} title="No gap for visitors">Until your domain points at Plexo, WordPress keeps answering. After, Plexo does.</AsideItem>
          <AsideItem icon={<Link2 size={18} />} title="Same addresses">Bookmarks, shared links and search results keep working.</AsideItem>
          <AsideItem icon={<ShieldCheck size={18} />} title="Keep WordPress for now">Cancel your old hosting only once we confirm the switch is complete.</AsideItem>
        </AsideCard>
      }
    >
      {children}
      <div><SecondaryButton onClick={onBack}><ArrowLeft size={15} /> Back to checking my site</SecondaryButton></div>
    </StepShell>
  );
}
