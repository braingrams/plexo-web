"use client";

import { GateOrError } from "../../_components/UpgradePrompt";
import { rememberPlanGate } from "@/lib/plan/planGate";
import "./insights.css";
import { useCallback, useEffect, useState } from "react";
import { BarChart3, Link2Off, Lock, RefreshCw } from "lucide-react";
import { Button, ButtonLink, Card, CardHeader, Input, Notice, Skeleton } from "../ui";
import { CookieNoticeCard } from "./CookieNoticeCard";
import type { Insight } from "@/lib/googleAnalytics/insights";
import type { AnalyticsReport, Ranked, RangeDays, Totals } from "@/lib/googleAnalytics/types";

type Choice = { accountName: string; accountDisplayName: string; propertyName: string; propertyDisplayName: string };
type Options = { managed: boolean; own: boolean };
type Extra = { mock?: boolean; mode?: "managed" | "own"; options?: Options; googleEmail?: string | null; handedOverTo?: string | null };
type Payload =
  | { state: "unavailable" }
  | { state: "upgrade"; message?: string }
  | ({ state: "not_connected" | "needs_account" | "needs_reconnect" | "error" } & Extra)
  | ({ state: "choose"; choices: Choice[] } & Extra)
  | ({ state: "ready"; report: AnalyticsReport; insights: Insight[]; propertyName?: string | null; justConnected?: boolean } & Extra);

const RESULT_NOTICE: Record<string, { kind: "success" | "warning" | "error"; title: string; body: string }> = {
  connected: { kind: "success", title: "Visitor numbers are on", body: "We added the counting to your site. Data usually appears in a few hours." },
  upgrade: { kind: "warning", title: "Detailed visitor numbers need a paid plan", body: "Your simple visit counts stay free. Pick a plan to switch on the detailed numbers." },
  cancelled: { kind: "warning", title: "You didn't finish signing in", body: "No problem. Press Connect whenever you're ready." },
  permissions: { kind: "warning", title: "We need both permissions", body: "Google asked if we can read your visits and set up your site. Please tick both boxes, so we can do the setup for you." },
  failed: { kind: "error", title: "That didn't work", body: "Google didn't let us finish. Please try again." },
  setup_failed: { kind: "error", title: "You're signed in, but setup didn't finish", body: "Press Finish setup below and we'll try again." },
  unavailable: { kind: "warning", title: "Google connection isn't ready yet", body: "Plexo's Google connection isn't switched on here yet. Please try again later." },
};

const change = (cur: number, prev: number) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null);

function Delta({ cur, prev }: { cur: number; prev: number }) {
  const c = change(cur, prev);
  if (c === null || c === 0) return null;
  return <span className="plx-hga__delta" data-dir={c > 0 ? "up" : "down"}>{c > 0 ? `Up ${c}%` : `Down ${Math.abs(c)}%`} on before</span>;
}

function stay(s: number): string {
  return s < 60 ? `${s} sec` : `${Math.floor(s / 60)} min ${s % 60} sec`;
}

function Rank({ title, description, items, unit }: { title: string; description?: string; items: Ranked[]; unit: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <Card>
      <CardHeader title={title} description={description} />
      {items.length === 0 ? <p className="plx-body">Nothing to show yet.</p> : (
        <ul className="plx-hga__rank">
          {items.map((i) => (
            <li key={i.name}>
              <div className="row"><span>{i.name}</span><span>{i.value} {unit}</span></div>
              <div className="plx-hga__meter" aria-hidden><i style={{ width: `${Math.max(3, (i.value / max) * 100)}%` }} /></div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function GoogleVisits({ siteId, live, result }: { siteId: string; live: boolean; result?: string }) {
  const [days, setDays] = useState<RangeDays>(28);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/sites/${siteId}/google-analytics?days=${days}`, { cache: "no-store" });
      setData(res.ok ? ((await res.json()) as Payload) : { state: "error" });
    } catch {
      setData({ state: "error" });
    } finally {
      setLoading(false);
    }
  }, [siteId, days]);
  useEffect(() => { void load(); }, [load]);

  async function act(body: Record<string, unknown>, key: string) {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(`/api/v1/sites/${siteId}/google-analytics`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) { rememberPlanGate(json); setError(json.error ?? "That didn't work. Please try again."); }
      await load();
    } catch {
      setError("We couldn't reach Plexo. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  const connectHref = `/api/google-analytics/start?siteId=${encodeURIComponent(siteId)}`;
  const banner = result && RESULT_NOTICE[result] ? RESULT_NOTICE[result] : null;
  // The bigger picture first: this card sits under the simple visit counts.
  return (
    <section className="plx-hga" aria-label="Google Analytics">
      {banner ? <Notice kind={banner.kind} title={banner.title}>{banner.body}</Notice> : null}
      <GateOrError error={error}><Notice kind="error" title="Something went wrong">{error}</Notice></GateOrError>

      {loading && !data ? <Card><Skeleton style={{ height: 120 }} /></Card> : null}

      {data?.state === "upgrade" ? (
        <Card>
          <div className="plx-hga__connect">
            <Lock size={28} aria-hidden />
            <h3 className="plx-h3">See where your visitors come from</h3>
            <p className="plx-body">{data.message ?? "Detailed visitor numbers come with a paid plan (Starter and above). Your simple visit counts above stay free."}</p>
            <ButtonLink href="/dashboard/settings/plan">See plans</ButtonLink>
          </div>
        </Card>
      ) : null}

      {data?.state === "unavailable" ? (
        <Card>
          <div className="plx-hga__connect">
            <BarChart3 size={28} aria-hidden />
            <h3 className="plx-h3">Detailed numbers are coming</h3>
            <p className="plx-body">Your simple visit counts above are always on. Detailed numbers (where people come from, which pages they like) aren&apos;t switched on in Plexo yet.</p>
          </div>
        </Card>
      ) : null}

      {data?.state === "not_connected" ? (
        <Card>
          <div className="plx-hga__connect">
            <BarChart3 size={32} aria-hidden />
            <h3 className="plx-h3">See where your visitors come from</h3>
            {!live ? (
              <p className="plx-body">Publish your site first. Counting starts from its web address.</p>
            ) : (
              <>
                {data.options?.managed !== false ? (
                  <>
                    <p className="plx-body">See who visits, which pages they like, where they come from and what they use, explained in plain words. One click. Plexo does the setup, so you don&apos;t need a Google account.</p>
                    <Button loading={busy === "use_plexo"} onClick={() => act({ action: "use_plexo" }, "use_plexo")}>Turn on visitor numbers</Button>
                    {data.options?.own ? <Button variant="ghost" onClick={() => { window.location.href = connectHref; }}>I&apos;d rather use my own Google account</Button> : null}
                  </>
                ) : (
                  <>
                    <p className="plx-body">Connect Google Analytics and see who visits, which pages they like and where they come from, explained in plain words. Press the button and sign in with Google. We do the rest.</p>
                    <Button onClick={() => { window.location.href = connectHref; }}>Connect Google Analytics</Button>
                  </>
                )}
                <p className="plx-body" style={{ fontSize: 13 }}>Visitors in Europe will see a small cookie notice. That&apos;s the law, and you can change how it looks below once you&apos;re set up. You can turn this off at any time.</p>
              </>
            )}
          </div>
        </Card>
      ) : null}

      {data?.state === "choose" ? (
        <Card>
          <CardHeader title="Pick where to keep your numbers" description={data.googleEmail ? `Signed in as ${data.googleEmail}` : undefined} />
          <div className="plx-hga__choices">
            {data.choices.length === 0 ? <p className="plx-body">You're signed in. One more step to finish setting up your site.</p> : data.choices.map((c) => (
              <Button key={c.propertyName} variant="secondary" loading={busy === c.propertyName} onClick={() => act({ action: "choose", accountName: c.accountName, propertyName: c.propertyName, propertyDisplayName: c.propertyDisplayName }, c.propertyName)}>
                {c.propertyDisplayName} <span style={{ opacity: 0.7 }}>({c.accountDisplayName})</span>
              </Button>
            ))}
            <Button variant={data.choices.length ? "ghost" : "primary"} loading={busy === "new"} onClick={() => act({ action: data.choices.length ? "create_new" : "retry" }, "new")}>{data.choices.length ? "Make a new one for this site" : "Finish setup"}</Button>
          </div>
        </Card>
      ) : null}

      {data?.state === "needs_account" ? (
        <Card>
          <div className="plx-hga__connect">
            <h3 className="plx-h3">One quick step on Google</h3>
            <p className="plx-body">This Google account doesn't have a Google Analytics account yet. Make a free one at analytics.google.com (it takes a minute), then come back and press the button.</p>
            <Button loading={busy === "retry"} onClick={() => act({ action: "retry" }, "retry")}>I've done it, finish setup</Button>
            <Button variant="ghost" onClick={() => act({ action: "disconnect" }, "disconnect")}>Use a different Google account</Button>
          </div>
        </Card>
      ) : null}

      {data?.state === "needs_reconnect" ? (
        <Card>
          <div className="plx-hga__connect">
            <Link2Off size={28} aria-hidden />
            <h3 className="plx-h3">Google needs you to sign in again</h3>
            <p className="plx-body">Plexo lost permission to read your visits. This happens when the access is removed in your Google account. Your site keeps working, and nothing is lost.</p>
            <Button onClick={() => { window.location.href = connectHref; }}>Sign in with Google again</Button>
          </div>
        </Card>
      ) : null}

      {data?.state === "error" ? (
        <Notice kind="error" title="We couldn't get your Google numbers" action={{ label: "Try again", onClick: () => void load() }}>Google didn't answer just now. Your site is fine, and your simple visit counts above are still live. Try again in a minute.</Notice>
      ) : null}

      {data?.state === "ready" ? <Ready data={data} siteId={siteId} days={days} setDays={setDays} refresh={() => void load()} disconnect={() => act({ action: "disconnect" }, "disconnect")} handOver={(email) => act({ action: "hand_over", email }, "hand_over")} busy={busy} /> : null}
    </section>
  );
}

function Ready({ data, siteId, days, setDays, refresh, disconnect, handOver, busy }: { data: Extract<Payload, { state: "ready" }>; siteId: string; days: RangeDays; setDays: (d: RangeDays) => void; refresh: () => void; disconnect: () => void; handOver: (email: string) => void; busy: string | null }) {
  const managed = data.mode === "managed";
  const [email, setEmail] = useState("");
  const [handing, setHanding] = useState(false);
  const { report } = data;
  const t: Totals = report.totals;
  const max = Math.max(1, ...report.daily.map((d) => d.visitors));
  return (
    <>
      <div className="plx-hga__bar">
        <div className="plx-hga__range" role="group" aria-label="Time period">
          {([7, 28, 90] as RangeDays[]).map((d) => <Button key={d} size="sm" variant={d === days ? "primary" : "secondary"} onClick={() => setDays(d)}>{d === 7 ? "Last week" : d === 28 ? "Last 4 weeks" : "Last 3 months"}</Button>)}
        </div>
        <div className="plx-hga__range">
          <Button size="sm" variant="ghost" leftIcon={<RefreshCw size={16} />} onClick={refresh}>Refresh</Button>
          <Button size="sm" variant="ghost" loading={busy === "disconnect"} onClick={disconnect}>{managed ? "Turn off visitor numbers" : "Disconnect Google"}</Button>
        </div>
      </div>
      {data.mock ? <Notice kind="info" title="Sample numbers">Google isn't connected in this version of Plexo, so these numbers are an example.</Notice> : null}
      {data.justConnected ? <Notice kind="info" title="Counting has started">Data usually appears in a few hours, and the first full day can take up to a day. Nothing is wrong if you only see zeros for now.</Notice> : null}

      <Card>
        <CardHeader title="What this means" description="The short version, in plain words." />
        <ul className="plx-hga__insights">{data.insights.map((i, n) => <li key={n} data-tone={i.tone}>{i.text}</li>)}</ul>
      </Card>

      <div className="plx-hstats">
        <Card className="plx-hstat"><b>{t.visitors}</b><span>people visited</span><Delta cur={t.visitors} prev={report.previous.visitors} /></Card>
        <Card className="plx-hstat"><b>{t.pageViews}</b><span>pages looked at</span><Delta cur={t.pageViews} prev={report.previous.pageViews} /></Card>
        <Card className="plx-hstat"><b>{t.avgSeconds ? stay(t.avgSeconds) : "–"}</b><span>average time on your site</span></Card>
        <Card className="plx-hstat"><b>{Math.round(t.engagedShare * 100)}%</b><span>of visits looked around, not just glanced</span></Card>
      </div>

      <Card>
        <CardHeader title="Visitors, day by day" />
        <div className="plx-bars" role="img" aria-label={`Visitors per day, ${t.visitors} in total`}>
          {report.daily.map((d, i) => (
            <div key={d.date} className="plx-bars__col" title={`${d.date}: ${d.visitors} visitors`}>
              <div className="plx-bars__bar" style={{ height: `${Math.max(3, (d.visitors / max) * 100)}%`, opacity: d.visitors ? 1 : 0.35 }} />
              <span className="plx-bars__lab">{report.daily.length <= 14 || i % Math.ceil(report.daily.length / 7) === 0 ? new Date(`${d.date}T12:00:00Z`).toLocaleDateString("en", { month: "short", day: "numeric" }) : " "}</span>
            </div>
          ))}
        </div>
      </Card>

      <div className="plx-hga__cols">
        <Card>
          <CardHeader title="Most popular pages" />
          {report.topPages.length === 0 ? <p className="plx-body">Nothing to show yet.</p> : (
            <ul className="plx-hga__rank">
              {report.topPages.map((p) => (
                <li key={p.path}><div className="row"><span>{p.path === "/" ? "Home page" : p.title || p.path}</span><span>{p.views} views</span></div><div className="plx-hga__meter" aria-hidden><i style={{ width: `${Math.max(3, (p.views / Math.max(1, report.topPages[0].views)) * 100)}%` }} /></div></li>
              ))}
            </ul>
          )}
        </Card>
        <Rank title="Where people came from" items={report.sources} unit="visits" />
        <Rank title="Countries" items={report.countries} unit="people" />
        <Rank title="What they use" description="Phone, computer or tablet." items={report.devices} unit="people" />
      </div>
      <p className="plx-health__when">{managed ? "Numbers are counted by Plexo using Google Analytics" : `Numbers come from your Google Analytics${data.googleEmail ? ` (${data.googleEmail})` : ""}`} and can be a few hours behind.</p>

      <CookieNoticeCard siteId={siteId} />

      {managed ? (
        <Card>
          <CardHeader title="Want to keep these numbers in your own Google account?" description="Optional. Plexo keeps counting and showing them here too." />
          {data.handedOverTo ? (
            <p className="plx-body">Shared with <b>{data.handedOverTo}</b>. Open analytics.google.com with that account to see it.</p>
          ) : !handing ? (
            <Button variant="secondary" onClick={() => setHanding(true)}>Share with my Google account</Button>
          ) : (
            <div className="plx-hga__connect">
              <Input label="Your Google email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" help="The address you sign in to Google with. You'll be able to see and change your site's numbers there." />
              <Button loading={busy === "hand_over"} disabled={!email.includes("@")} onClick={() => handOver(email)}>Share it</Button>
            </div>
          )}
        </Card>
      ) : null}
    </>
  );
}
