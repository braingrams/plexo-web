"use client";

import { GateOrError } from "@/app/dashboard/_components/UpgradePrompt";
import { useCallback, useEffect, useRef, useState } from "react";
import "./insights.css";
import "./health.css";
import { Check, Code2, Gauge, Monitor, PartyPopper, Pencil, RefreshCw, Smartphone, Undo2, Wrench } from "lucide-react";
import { BannerStack, Button, ButtonLink, Card, CardHeader, Modal, Notice, SegmentedControl, Skeleton } from "../ui";
import { TabBar } from "./HubFrame";
import { scoreLook } from "@/lib/siteHealth/explain";
import type { MetricView } from "@/lib/siteHealth/explain";
import type { AutoFixId, HealthStatus, Issue, Rating } from "@/lib/siteHealth/types";

type Scores = { speed: number; search: number; easyToUse: number; safeAndTidy: number } | null;
type Device = { scores: Scores; metrics: MetricView[] } | null;
type Payload = HealthStatus & {
  available: boolean;
  headline: string | null;
  headlineTone: Rating | null;
  perfect: boolean;
  devices: { phone: Device; computer: Device } | null;
  issues: Issue[];
  fixableCount: number;
  trend: string | null;
  newSiteNote: string | null;
};
type BusinessValues = { kind?: "local" | "online"; name?: string; phone?: string; email?: string; address?: { street?: string; city?: string; region?: string; postalCode?: string; country?: string }; hours?: { days: number[]; opens: string; closes: string }[]; logo?: string; sameAs?: string[] };
type TextItem = { key: string; label: string; text: string };
type Preview = {
  fix: AutoFixId;
  notes: string[];
  text?: string;
  aeo?: { from: number; to: number };
  error?: string;
  business?: { values: BusinessValues; found: string[]; missing: { field: string; label: string; why: string }[] };
  texts?: { kind: "titles" | "pictures"; items: TextItem[]; more: boolean; skipped: number; credits: number; error?: string };
};
type EverythingPreview = { fixes: Preview[]; aeo?: { from: number; to: number } };
type Summary = { done: { fix: AutoFixId; label: string; notes: string[] }[]; skipped: { fix: AutoFixId; reason: string }[]; aeo?: { from: number; to: number } };

const TONE_VAR: Record<Rating, string> = { good: "var(--plx-success)", okay: "var(--plx-warning)", poor: "var(--plx-danger)" };

/** A big friendly ring: colour, number and a word, so colour is never the only signal. */
function Ring({ score, label, hint, size = 132, delta }: { score: number | null; label: string; hint: string; size?: number; delta?: number | null }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const look = score == null ? null : scoreLook(score);
  return (
    <div className="plx-hring" style={{ ["--ring-size" as string]: `${size}px` }}>
      <svg viewBox="0 0 120 120" width={size} height={size} role="img" aria-label={score == null ? `${label}: not measured` : `${label}: ${score} out of 100, ${look!.label}`}>
        <circle cx="60" cy="60" r={r} fill="none" stroke="var(--plx-border)" strokeWidth="10" />
        {score != null && look ? <circle cx="60" cy="60" r={r} fill="none" stroke={TONE_VAR[look.tone]} strokeWidth="10" strokeLinecap="round" strokeDasharray={`${(score / 100) * c} ${c}`} transform="rotate(-90 60 60)" /> : null}
        <text x="60" y="68" textAnchor="middle" className="plx-hring__num">{score == null ? "–" : score}</text>
      </svg>
      <b className="plx-hring__label">{label}</b>
      <span className="plx-hring__word" style={{ color: look ? TONE_VAR[look.tone] : undefined }}>{look?.label ?? "Not measured"}</span>
      {delta ? <span className="plx-hga__delta" data-dir={delta > 0 ? "up" : "down"}>{delta > 0 ? "+" : ""}{delta} since last check</span> : null}
      <span className="plx-hring__hint">{hint}</span>
    </div>
  );
}

function Trend({ history, text }: { history: HealthStatus["history"]; text: string | null }) {
  const pts = history.filter((h) => h.speed != null);
  if (pts.length < 2) return null;
  const w = 320;
  const h = 70;
  const line = (key: "speed" | "aeo") => history.map((p, i) => (p[key] == null ? null : `${(i / (history.length - 1)) * (w - 8) + 4},${h - 6 - ((p[key] as number) / 100) * (h - 12)}`)).filter(Boolean).join(" ");
  return (
    <Card>
      <CardHeader title="How you're doing over time" description="Each point is one check. Higher is better." />
      {text ? <p className="plx-htrendtext">{text}</p> : null}
      <svg viewBox={`0 0 ${w} ${h}`} className="plx-htrend" role="img" aria-label={`Your speed and AI visibility scores over your last ${history.length} checks. ${text ?? ""}`}>
        <polyline points={line("speed")} fill="none" stroke="var(--plx-brand)" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
        <polyline points={line("aeo")} fill="none" stroke="var(--plx-info)" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" strokeDasharray="1 7" />
      </svg>
      <div className="plx-htrend__key"><span><i style={{ background: "var(--plx-brand)" }} /> Speed</span><span><i style={{ background: "var(--plx-info)" }} /> AI visibility</span></div>
    </Card>
  );
}

function Metrics({ metrics }: { metrics: MetricView[] }) {
  return (
    <ul className="plx-hmetrics plx-hmetrics--rich">
      {metrics.map((m) => (
        <li key={m.key}>
          <div className="plx-hmetric__top">
            <span className="plx-hmetrics__dot" style={{ background: m.tone ? TONE_VAR[m.tone] : "var(--plx-border-strong)" }} aria-hidden />
            <b className="plx-hmetric__name">{m.name}</b>
            <span className="plx-hmetric__value">{m.value}</span>
          </div>
          <span className="plx-hmetric__verdict" style={{ color: m.tone ? TONE_VAR[m.tone] : undefined }}>{m.verdict}</span>
          <p className="plx-hmetric__line">{m.meaning}</p>
          <p className="plx-hmetric__line">{m.limits}</p>
          <details className="plx-hmetric__tip">
            <summary>What&apos;s this? ({m.term})</summary>
            <p>{m.tip}</p>
            <p>{m.source}</p>
          </details>
        </li>
      ))}
    </ul>
  );
}

/** Adds the editor's "go to this element" parameters (lib/siteHealth/editorLinks.ts) to the editor address. */
function withQuery(href: string, query: string | undefined): string {
  return query ? `${href}${href.includes("?") ? "&" : "?"}${query}` : href;
}

function IssueRow({ issue, busy, editHref, onFix, onUndo }: { issue: Issue; busy: boolean; editHref?: string; onFix: (issue: Issue) => void; onUndo: (issue: Issue) => void }) {
  const done = issue.autoFix?.on;
  const manualHere = issue.steps.length > 0;
  return (
    <li className="plx-hissue" data-tone={issue.severity}>
      <span className="plx-hissue__dot" aria-hidden />
      <div className="plx-hissue__body">
        <b className="plx-hissue__title">{issue.title}</b>
        {issue.gain && !done ? <span className="plx-hissue__gain">{issue.gain}</span> : null}
        <p className="plx-hissue__why">{issue.why}</p>
        <div className="plx-hissue__actions">
          {issue.autoFix ? (
            done ? (
              <>
                <span className="plx-hissue__done"><Check size={16} aria-hidden /> Done for you</span>
                <Button size="sm" variant="ghost" leftIcon={<Undo2 size={16} />} loading={busy} onClick={() => onUndo(issue)}>Undo</Button>
              </>
            ) : (
              <Button size="sm" leftIcon={<Wrench size={16} />} loading={busy} loadingLabel="Working…" onClick={() => onFix(issue)}>{issue.autoFix.label}</Button>
            )
          ) : null}
          {!done && editHref && issue.editorHint === "editor" ? <ButtonLink size="sm" variant="secondary" href={withQuery(editHref, issue.where?.find((w) => w.editor)?.editor)} leftIcon={<Pencil size={16} aria-hidden />}>{issue.where?.some((w) => w.editor) ? "Take me to it" : "Open the editor"}</ButtonLink> : null}
        </div>
        {manualHere && !done ? (
          <details className="plx-hissue__how">
            <summary>Show me how</summary>
            {issue.where?.length ? (
              <div className="plx-hissue__where">
                <b>Look for this on your page:</b>
                {issue.where.map((w, i) => (
                  <span key={i}>
                    {w.label ? `${w.label} ` : ""}<code>{w.snippet || w.selector}</code>
                    {editHref && w.editor ? <> <a href={withQuery(editHref, w.editor)}>Show me in the editor</a></> : null}
                    {editHref && w.code && w.code !== w.editor ? <> <a href={withQuery(editHref, w.code)}><Code2 size={14} aria-hidden /> Show me in the code</a></> : null}
                  </span>
                ))}
              </div>
            ) : null}
            <ol>{issue.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
          </details>
        ) : null}
      </div>
    </li>
  );
}

/** What the owner edited in the preview, in the shape the fix endpoint takes. */
function extraFor(p: { loaded: Preview | null; business?: BusinessValues; items?: TextItem[] }): Record<string, unknown> {
  if (p.loaded?.business && p.business) return { business: p.business };
  if (p.loaded?.texts && p.items) {
    const map = Object.fromEntries(p.items.map((i) => [i.key, i.text]));
    return p.loaded.texts.kind === "titles" ? { titles: map } : { alts: map };
  }
  return {};
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The few things we could not find, asked for in plain words. Everything we already know is shown filled in and can be changed. */
function BusinessForm({ loaded, value, onChange }: { loaded: NonNullable<Preview["business"]>; value: BusinessValues; onChange: (v: BusinessValues) => void }) {
  const set = (patch: Partial<BusinessValues>) => onChange({ ...value, ...patch });
  const addr = value.address ?? {};
  const local = value.kind === "local";
  const asked = loaded.missing.map((m) => m.field);
  return (
    <div className="plx-hform">
      {loaded.found.length ? <p className="plx-hnote">We already found {loaded.found.join(", ")}. Check them below.</p> : null}
      <fieldset className="plx-hform__kind">
        <legend><b>Can people visit you?</b></legend>
        <label><input type="radio" name="plx-bkind" checked={local} onChange={() => set({ kind: "local" })} /> Yes, I have a place customers come to</label>
        <label><input type="radio" name="plx-bkind" checked={!local} onChange={() => set({ kind: "online" })} /> No, I work online or travel to people</label>
      </fieldset>
      <label className="plx-hform__field">Business name<input value={value.name ?? ""} maxLength={120} onChange={(e) => set({ name: e.target.value })} />{asked.includes("name") ? <small>Search tools call you by this.</small> : null}</label>
      <label className="plx-hform__field">Phone number{local ? "" : " (optional)"}<input type="tel" value={value.phone ?? ""} maxLength={40} onChange={(e) => set({ phone: e.target.value })} />{asked.includes("phone") ? <small>People can call you straight from Google.</small> : null}</label>
      <label className="plx-hform__field">Email (optional)<input type="email" value={value.email ?? ""} maxLength={200} onChange={(e) => set({ email: e.target.value })} /></label>
      {local ? (
        <>
          <label className="plx-hform__field">Street address<input value={addr.street ?? ""} maxLength={200} onChange={(e) => set({ address: { ...addr, street: e.target.value } })} />{asked.includes("address") ? <small>Google shows it on maps and in &quot;near me&quot; results.</small> : null}</label>
          <div className="plx-hform__row">
            <label className="plx-hform__field">Town or city<input value={addr.city ?? ""} maxLength={100} onChange={(e) => set({ address: { ...addr, city: e.target.value } })} /></label>
            <label className="plx-hform__field">State or region<input value={addr.region ?? ""} maxLength={100} onChange={(e) => set({ address: { ...addr, region: e.target.value } })} /></label>
            <label className="plx-hform__field">Country<input value={addr.country ?? ""} maxLength={100} onChange={(e) => set({ address: { ...addr, country: e.target.value } })} /></label>
          </div>
          {value.hours?.length ? <p className="plx-hnote">Open {value.hours.map((h) => `${h.days.map((d) => DAYS[d]).join(", ")} ${h.opens} to ${h.closes}`).join("; ")} (from your booking times).</p> : null}
        </>
      ) : null}
    </div>
  );
}

export function HealthTab({ siteId, live, editHref }: { siteId: string; live: boolean; editHref?: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fixing, setFixing] = useState<string | null>(null);
  const [device, setDevice] = useState<"phone" | "computer">("phone");
  const [preview, setPreview] = useState<{ issue: Issue; loaded: Preview | null; text: string; business?: BusinessValues; items?: TextItem[]; regenerating?: boolean } | null>(null);
  const [everything, setEverything] = useState<EverythingPreview | "loading" | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [justFixed, setJustFixed] = useState(false);
  const autoRan = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/sites/${siteId}/health`, { cache: "no-store" });
      if (!res.ok) throw new Error();
      setData((await res.json()) as Payload);
    } catch {
      setError("We couldn't load your last check. Refresh the page and try again.");
    } finally {
      setLoading(false);
    }
  }, [siteId]);
  useEffect(() => { void load(); }, [load]);

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/sites/${siteId}/health`, { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as Payload & { error?: string };
      if (!res.ok) setError(json.error ?? "The check didn't work. Please try again.");
      else {
        setData(json);
        setJustFixed(false);
      }
    } catch {
      setError("We couldn't reach the speed test. Check your connection and try again.");
    } finally {
      setRunning(false);
    }
  }, [siteId]);

  // The site changed since the last check (published or edited): look again by ourselves, once.
  useEffect(() => {
    // A re-check is already queued for a few minutes from now (it starts by itself): let it, rather than running one here.
    const waiting = data?.auto?.reason === "changed" && data.auto.nextAt && new Date(data.auto.nextAt).getTime() > Date.now();
    if (autoRan.current || !data || !data.url || !data.last || !data.stale || data.nextCheckAt || waiting) return;
    autoRan.current = true;
    void run();
  }, [data, run]);

  /** The weekly email: switched on or off right away, and put back if it did not save. */
  async function setDigest(enabled: boolean) {
    if (!data) return;
    const before = data.settings.emailDigest;
    setData({ ...data, settings: { ...data.settings, emailDigest: enabled } });
    try {
      const res = await fetch(`/api/v1/sites/${siteId}/health/digest`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled }) });
      if (!res.ok) throw new Error("save failed");
    } catch {
      setData((d) => (d ? { ...d, settings: { ...d.settings, emailDigest: before } } : d));
      setError("We couldn't change the weekly email. Please try again.");
    }
  }

  async function post(body: Record<string, unknown>) {
    const res = await fetch(`/api/v1/sites/${siteId}/health/fix`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: res.ok, json };
  }

  async function openPreview(issue: Issue) {
    if (!issue.autoFix) return;
    setError(null);
    setPreview({ issue, loaded: null, text: "" });
    try {
      const { ok, json } = await post({ fix: issue.autoFix.id, preview: true });
      if (!ok) throw new Error((json as { error?: string }).error);
      const p = json as unknown as Preview;
      setPreview({ issue, loaded: p, text: p.text ?? "", business: p.business?.values, items: p.texts?.items });
    } catch (e) {
      setPreview(null);
      setError(e instanceof Error && e.message ? e.message : "We couldn't work out what this fix would change. Please try again.");
    }
  }

  async function regenerate() {
    if (!preview?.issue.autoFix) return;
    const issue = preview.issue;
    setPreview({ ...preview, regenerating: true });
    try {
      const { ok, json } = await post({ fix: issue.autoFix!.id, preview: true, regenerate: true });
      if (!ok) throw new Error((json as { error?: string }).error);
      const p = json as unknown as Preview;
      setPreview({ issue, loaded: p, text: p.text ?? "", business: p.business?.values, items: p.texts?.items });
    } catch (e) {
      setPreview((cur) => (cur ? { ...cur, regenerating: false } : cur));
      setError(e instanceof Error && e.message ? e.message : "We couldn't write them again just now. Please try again.");
    }
  }

  async function apply(issue: Issue, enabled: boolean, text?: string, extra: Record<string, unknown> = {}) {
    if (!issue.autoFix) return;
    setFixing(issue.id);
    setError(null);
    try {
      const { ok, json } = await post({ fix: issue.autoFix.id, enabled, ...(text ? { text } : {}), ...extra });
      if (!ok) setError(json.error ?? "That fix didn't work. Please try again.");
      else {
        setData(json as unknown as Payload);
        setJustFixed(enabled);
        setPreview(null);
      }
    } catch {
      setError("We couldn't make that change. Please try again.");
    } finally {
      setFixing(null);
    }
  }

  async function openEverything() {
    setEverything("loading");
    setSummary(null);
    try {
      const { ok, json } = await post({ all: true, preview: true });
      if (!ok) throw new Error(json.error);
      setEverything(json as unknown as EverythingPreview);
    } catch (e) {
      setEverything(null);
      setError(e instanceof Error && e.message ? e.message : "We couldn't prepare the fixes. Please try again.");
    }
  }

  async function applyEverything() {
    setFixing("all");
    try {
      const { ok, json } = await post({ all: true });
      if (!ok) setError(json.error ?? "That didn't work. Please try again.");
      else {
        const j = json as unknown as Payload & { summary?: Summary };
        if (j.summary?.aeo?.to && j.last?.report?.aeo) {
          j.last.report.aeo.score = j.summary.aeo.to;
        }
        setData(j);
        setSummary(j.summary ?? null);
        setJustFixed(true);
      }
    } catch {
      setError("We couldn't make those changes. Please try again.");
    } finally {
      setFixing(null);
      setEverything(null);
    }
  }

  async function undoEverything() {
    setFixing("all");
    try {
      const { ok, json } = await post({ all: true, enabled: false });
      if (!ok) setError(json.error ?? "That didn't work. Please try again.");
      else {
        setData(json as unknown as Payload);
        setSummary(null);
      }
    } finally {
      setFixing(null);
    }
  }

  const report = data?.last?.report ?? null;
  const when = data?.last ? new Date(data.last.createdAt).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" }) : null;
  const sub = "How fast your site opens, and how easy it is for Google and AI assistants to understand.";

  if (loading) return (<><TabBar title="Site health" sub={sub} /><Card><Skeleton style={{ height: 180 }} /></Card></>);

  if (!live || (data && !data.url)) {
    return (
      <>
        <TabBar title="Site health" sub={sub} />
        <Card><div className="plx-health__empty"><Gauge size={36} aria-hidden /><h3 className="plx-h3">Publish your site to check it</h3><p className="plx-body">We test the live version of your site, so there&apos;s nothing to check until it&apos;s published. Once it&apos;s live, come back and press one button.</p></div></Card>
      </>
    );
  }

  const next = data?.nextCheckAt ? new Date(data.nextCheckAt) : null;
  const current = data?.devices ? (device === "computer" ? data.devices.computer : data.devices.phone) ?? data.devices.phone ?? data.devices.computer : null;
  const last2 = data && data.history.length >= 2 ? [data.history[data.history.length - 2], data.history[data.history.length - 1]] : null;
  const dSpeed = last2 && last2[0].speed != null && last2[1].speed != null ? last2[1].speed - last2[0].speed : null;
  const dAeo = last2 && last2[0].aeo != null && last2[1].aeo != null ? last2[1].aeo - last2[0].aeo : null;
  const open = data?.issues.filter((i) => i.severity !== "good") ?? [];
  const fixed = data?.issues.filter((i) => i.severity === "good") ?? [];
  const anyOn = !!data?.issues.some((i) => i.autoFix?.on);

  return (
    <>
      <TabBar title="Site health" sub={sub} action={<Button leftIcon={<RefreshCw size={16} />} loading={running} loadingLabel="Checking your site…" onClick={run}>{report ? "Check again" : "Check my site"}</Button>} />
      <BannerStack
        banners={
          <>
            {error ? <GateOrError error={error}><Notice kind="error" title="Something went wrong">{error}</Notice></GateOrError> : null}
            {running ? <Notice kind="info" title="Checking your site">This takes up to a minute. We open your site the way a visitor on a phone would, and then on a computer.</Notice> : null}
            {data?.stale && !running && report ? <Notice kind="info" title="Your site changed since the last check">We&apos;ll look again in a moment so the numbers match what visitors see.</Notice> : null}
            {justFixed && !running ? <Notice kind="success" title="Done">Your live site updates within a minute or two. Scores update automatically below.</Notice> : null}
            {next && !running && report && !justFixed && !data?.stale ? <Notice kind="info" title="Just checked">You can run another check after {next.toLocaleTimeString("en", { timeStyle: "short" })}.</Notice> : null}
            {report?.auto && !running ? <Notice kind="info" title="Checked for you">{report.auto === "weekly" ? "This is our weekly check." : "We checked again by ourselves after you changed your site."}</Notice> : null}
            {data && !data.available ? <Notice kind="warning" title="Speed test not switched on yet">We can still check how easy your site is to find. The speed part comes once Plexo&apos;s speed test is connected.</Notice> : null}
          </>
        }
      />
      {data?.auto?.nextAt && !running && report ? <p className="plx-health__when">{data.auto.reason === "changed" ? `We'll check again by ourselves around ${new Date(data.auto.nextAt).toLocaleTimeString("en", { timeStyle: "short" })}, a few minutes after your last change.` : `We also check by ourselves every week. The next one is around ${new Date(data.auto.nextAt).toLocaleDateString("en", { dateStyle: "medium" })}.`}</p> : null}
      {data && report && data.url ? (
        <div className="plx-toggle">
          <span style={{ minWidth: 0 }}><b style={{ display: "block", fontSize: 15 }}>Weekly email</b><span className="plx-small">A short note every week: how your site is doing, what changed and the 3 things to fix first.</span></span>
          <input type="checkbox" className="plx-switch" role="switch" checked={data.settings.emailDigest} aria-label="Weekly Site health email" onChange={(e) => void setDigest(e.target.checked)} />
        </div>
      ) : null}

      {!report ? (
        <Card>
          <div className="plx-health__empty">
            <Gauge size={36} aria-hidden />
            <h3 className="plx-h3">Let&apos;s see how your site is doing</h3>
            <p className="plx-body">We&apos;ll time your site and look for easy wins. It&apos;s free, and nothing changes unless you say so.</p>
            <Button leftIcon={<RefreshCw size={16} />} loading={running} loadingLabel="Checking your site…" onClick={run}>Check my site</Button>
          </div>
        </Card>
      ) : (
        <>
          {report.sample ? <Notice kind="info" title="Sample numbers">These speed numbers are an example, because the speed test isn&apos;t connected here.</Notice> : null}
          <Card>
            {data?.perfect ? <div className="plx-hcelebrate"><PartyPopper size={22} aria-hidden /> You did it. Every score is 100.</div> : null}
            <div className="plx-hhead">
              <p className="plx-health__headline" style={data?.headlineTone ? { color: TONE_VAR[data.headlineTone] } : undefined}>{data?.headline}</p>
              {data?.devices?.phone && data.devices.computer ? (
                <SegmentedControl label="Which device" value={device} onChange={setDevice} options={[{ value: "phone", label: "Phone", icon: <Smartphone size={16} aria-hidden /> }, { value: "computer", label: "Computer", icon: <Monitor size={16} aria-hidden /> }]} />
              ) : null}
            </div>
            {data?.trend ? <p className="plx-htrendtext">{data.trend}</p> : null}
            <div className="plx-hrings">
              <Ring score={current?.scores?.speed ?? null} label="Speed" hint={device === "phone" ? "How fast people see your page on a phone" : "How fast people see your page on a computer"} delta={device === "phone" ? dSpeed : null} />
              <Ring score={current?.scores?.search ?? null} label="Search" hint="How well Google can read it" />
              <Ring score={report.aeo?.score ?? null} label="AI visibility" hint="How easily AI assistants can use it" delta={dAeo} />
            </div>
            <div className="plx-hrings plx-hrings--small">
              <Ring size={84} score={current?.scores?.easyToUse ?? null} label="Easy to use" hint="For everyone, including screen readers" />
              <Ring size={84} score={current?.scores?.safeAndTidy ?? null} label="Safe and tidy" hint="No known problems" />
            </div>
            {report.speedError ? <p className="plx-body">{report.speedError}</p> : null}
            {report.aeoError ? <p className="plx-body">{report.aeoError}</p> : null}
            {data?.newSiteNote ? <p className="plx-hnote">{data.newSiteNote}</p> : null}
            {when ? <p className="plx-health__when">Checked {when} on {report.url.replace(/^https?:\/\//, "")}</p> : null}
          </Card>

          {current && current.metrics.length ? (
            <Card>
              <CardHeader title={`How your page feels on a ${device === "phone" ? "phone" : "computer"}`} description="Four timings that decide whether visitors stay. Tap What's this? on any of them." />
              <Metrics metrics={current.metrics} />
            </Card>
          ) : null}

          <Card>
            <div className="plx-hbar">
              <CardHeader title={open.length ? "Easy wins, biggest first" : "Looking good"} description="Press the button and we do it. Prefer to do it yourself? Open Show me how." />
              {data && data.fixableCount > 1 ? <Button leftIcon={<Wrench size={16} />} loading={fixing === "all"} onClick={openEverything}>Fix everything ({data.fixableCount})</Button> : null}
            </div>
            {summary ? (
              <div className="plx-hsummary">
                <Notice kind="success" title={`We fixed ${summary.done.length} ${summary.done.length === 1 ? "thing" : "things"}`}>
                  {summary.aeo ? `AI visibility should go from ${summary.aeo.from} to about ${summary.aeo.to}. ` : ""}Press Check again to see your real new scores.
                </Notice>
                <ul>
                  {summary.done.map((d) => <li key={d.fix}><b>{d.label}.</b> {d.notes.join(" ")}</li>)}
                  {summary.skipped.map((s) => <li key={s.fix}>Skipped one: {s.reason}</li>)}
                </ul>
                <div><Button size="sm" variant="ghost" leftIcon={<Undo2 size={16} />} loading={fixing === "all"} onClick={undoEverything}>Undo everything</Button></div>
              </div>
            ) : null}
            {data && open.length ? (
              <ul className="plx-hissues">{open.map((i) => <IssueRow key={i.id} issue={i} busy={fixing === i.id} editHref={editHref} onFix={openPreview} onUndo={(is) => apply(is, false)} />)}</ul>
            ) : (
              <p className="plx-body">We didn&apos;t find anything to fix. Nice work.</p>
            )}
          </Card>

          {fixed.length ? (
            <Card>
              <CardHeader title="Already done" description="Press Undo on any of these and your pages go back exactly as they were." />
              <ul className="plx-hissues">{fixed.map((i) => <IssueRow key={i.id} issue={i} busy={fixing === i.id} editHref={editHref} onFix={openPreview} onUndo={(is) => apply(is, false)} />)}</ul>
              {anyOn ? <div style={{ marginTop: 12 }}><Button size="sm" variant="ghost" leftIcon={<Undo2 size={16} />} loading={fixing === "all"} onClick={undoEverything}>Undo everything</Button></div> : null}
            </Card>
          ) : null}

          {data ? <Trend history={data.history} text={data.trend} /> : null}
        </>
      )}

      <Modal
        open={!!preview}
        onClose={() => setPreview(null)}
        title={preview?.issue.autoFix?.label ?? "Fix it for me"}
        description="Here is what will change. You can undo it at any time."
        footer={
          <>
            <Button variant="ghost" onClick={() => setPreview(null)}>Not now</Button>
            <Button loading={!!fixing} disabled={!preview?.loaded || !!preview.loaded.error || !!preview.regenerating} onClick={() => preview && void apply(preview.issue, true, preview.loaded?.text ? preview.text : undefined, extraFor(preview))}>Do it</Button>
          </>
        }
      >
        {!preview?.loaded ? <Skeleton style={{ height: 80 }} /> : (
          <div className="plx-hpreview">
            {preview.loaded.error ? <p className="plx-body">{preview.loaded.error}</p> : null}
            {preview.loaded.text !== undefined ? (
              <>
                <label htmlFor="plx-hsummary-text"><b>Your search summary (you can change it)</b></label>
                <textarea id="plx-hsummary-text" value={preview.text} onChange={(e) => setPreview({ ...preview, text: e.target.value })} maxLength={200} />
              </>
            ) : null}
            {preview.loaded.business && preview.business ? <BusinessForm loaded={preview.loaded.business} value={preview.business} onChange={(v) => setPreview({ ...preview, business: v })} /> : null}
            {preview.loaded.texts ? (
              <div className="plx-htexts">
                {preview.loaded.texts.error ? <p className="plx-body">{preview.loaded.texts.error}</p> : null}
                {preview.items?.length ? (
                  <ul className="plx-htexts__list">
                    {preview.items.map((it, idx) => (
                      <li key={it.key}>
                        <label htmlFor={`plx-htext-${idx}`}><b>{it.label}</b></label>
                        <input id={`plx-htext-${idx}`} value={it.text} maxLength={preview.loaded?.texts?.kind === "titles" ? 70 : 200} onChange={(e) => setPreview({ ...preview, items: preview.items!.map((x) => (x.key === it.key ? { ...x, text: e.target.value } : x)) })} />
                      </li>
                    ))}
                  </ul>
                ) : !preview.loaded.texts.error ? <p className="plx-body">{preview.loaded.texts.kind === "titles" ? "Every page already has a name." : "Every picture already has a description, or we could not open the ones that do not."}</p> : null}
                {preview.loaded.texts.more ? <p className="plx-hnote">There are more. Press Do it, then open this again to write the next ones.</p> : null}
                {preview.loaded.texts.skipped ? <p className="plx-hnote">We left {preview.loaded.texts.skipped} {preview.loaded.texts.kind === "titles" ? "pages" : "pictures"} alone because we could not read {preview.loaded.texts.skipped === 1 ? "it" : "them"} well enough to describe honestly.</p> : null}
                <div className="plx-htexts__bar">
                  <Button size="sm" variant="secondary" leftIcon={<RefreshCw size={16} />} loading={!!preview.regenerating} loadingLabel="Writing again…" onClick={regenerate}>Write them again</Button>
                  <span className="plx-hnote">{preview.loaded.texts.credits ? `Writing these used about ${preview.loaded.texts.credits} AI credit${preview.loaded.texts.credits === 1 ? "" : "s"}. ` : "Nothing is charged to look at these again. "}Writing again uses a little more.</span>
                </div>
              </div>
            ) : null}
            {preview.loaded.notes.length ? <ul>{preview.loaded.notes.filter((n) => preview.loaded?.text === undefined || !n.startsWith("Google shows")).map((n, i) => <li key={i}>{n}</li>)}</ul> : !preview.loaded.error ? <p className="plx-body">Nothing on your pages needs changing for this one right now.</p> : null}
            {preview.loaded.aeo ? <p className="plx-hpreview__gain">AI visibility: about {preview.loaded.aeo.from} now, about {preview.loaded.aeo.to} after.</p> : null}
            <p className="plx-hnote">Your own pages are never edited. This is added while pages are shown to visitors, so Undo puts everything back.</p>
          </div>
        )}
      </Modal>

      <Modal
        open={!!everything}
        onClose={() => setEverything(null)}
        title="Fix everything"
        description="We'll turn on every fix that applies. Each one can be undone."
        footer={
          <>
            <Button variant="ghost" onClick={() => setEverything(null)}>Not now</Button>
            <Button loading={fixing === "all"} disabled={everything === "loading"} onClick={applyEverything}>Do it all</Button>
          </>
        }
      >
        {everything === "loading" || !everything ? <Skeleton style={{ height: 120 }} /> : (
          <div className="plx-hpreview">
            <ul>
              {everything.fixes.filter((f) => !f.error).map((f) => <li key={f.fix}>{f.notes.length ? f.notes.join(" ") : "Switched on."}</li>)}
              {everything.fixes.filter((f) => f.error).map((f) => <li key={f.fix}>We&apos;ll skip one: {f.error}</li>)}
            </ul>
            {everything.aeo ? <p className="plx-hpreview__gain">AI visibility: about {everything.aeo.from} now, about {everything.aeo.to} after.</p> : null}
          </div>
        )}
      </Modal>
    </>
  );
}
