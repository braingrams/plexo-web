"use client";

import { UpgradePrompt } from "@/app/dashboard/_components/UpgradePrompt";
import { GateOrError } from "@/app/dashboard/_components/UpgradePrompt";
import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Download, Globe, Send, ShieldCheck } from "lucide-react";
import { Badge, Button, ButtonLink, Input, Select, useToast } from "../ui";
import { errMsg, hubApi } from "../hub/hubApi";
import { AsideCard, AsideStats, Notice, Panel, SettingsPageShell } from "./bits";

export type MoveSite = { id: string; name: string };
export type Incoming = { id: string; siteName: string; fromName: string; createdAt: string; expiresAt: string };
export type Outgoing = { id: string; templateId: string; siteName: string; toEmail: string; createdAt: string };
type Warning = { title: string; detail: string };

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

const SAFETY = [
  "I know this site will leave my account if they accept.",
  "I know they will own its pages, orders and web addresses.",
  "I've told them it's coming, and I trust them with it.",
];

/** Move a site to someone else's account (with safety steps), or bring one in from another place. */
export function MovingSection({ sites, incoming, outgoing, isOwner, canImport, mock = false }: { sites: MoveSite[]; incoming: Incoming[]; outgoing: Outgoing[]; isOwner: boolean; canImport: boolean; mock?: boolean }) {
  const { show } = useToast();
  const [siteId, setSiteId] = useState(sites[0]?.id ?? "");
  const [email, setEmail] = useState("");
  const [preview, setPreview] = useState<{ exists: boolean; warnings: Warning[] } | null>(null);
  const [ticks, setTicks] = useState<boolean[]>(SAFETY.map(() => false));
  const [sent, setSent] = useState<Outgoing[]>(outgoing);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importInto, setImportInto] = useState(sites[0]?.id ?? "");

  const site = sites.find((s) => s.id === siteId);
  const allTicked = ticks.every(Boolean);

  async function check() {
    setError(null);
    setPreview(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError("Please type the email address of the person you're giving the site to.");
    setBusy("check");
    try {
      const d = mock ? { recipientExists: true, warnings: [{ title: "Your online store comes too", detail: "Products, orders and your payout details move to them. Customers see no change." }] } : await hubApi<{ recipientExists: boolean; warnings?: Warning[] }>(`/api/templates/${siteId}/transfer`, { method: "POST", json: { toEmail: email.trim() } }, "We couldn't check that. Please try again.");
      setPreview({ exists: d.recipientExists, warnings: d.warnings ?? [] });
      setTicks(SAFETY.map(() => false));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    setBusy("send");
    setError(null);
    try {
      const d = mock ? { request: { id: `t${Date.now()}`, toEmail: email.trim(), createdAt: new Date().toISOString() } } : await hubApi<{ request: { id: string; toEmail: string; createdAt: string } }>(`/api/templates/${siteId}/transfer`, { method: "POST", json: { toEmail: email.trim(), confirm: true } }, "We couldn't send that. Please try again.");
      setSent((p) => [{ id: d.request.id, templateId: siteId, siteName: site?.name ?? "Your site", toEmail: d.request.toEmail, createdAt: d.request.createdAt }, ...p]);
      setPreview(null);
      setEmail("");
      show({ title: "Sent", description: "Nothing moves until they accept. You can cancel until then.", tone: "success" });
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function cancel(t: Outgoing) {
    setBusy(t.id);
    try {
      if (!mock) await hubApi(`/api/templates/${t.templateId}/transfer`, { method: "DELETE" }, "We couldn't cancel that. Please try again.");
      setSent((p) => p.filter((x) => x.id !== t.id));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <SettingsPageShell
      title="Move a site"
      purpose="Give one of your sites to someone else, or bring a site in from somewhere else."
      aside={
        <>
        <AsideCard title="Right now" icon={Send}>
          <AsideStats items={[
            { label: "Your sites", value: sites.length },
            { label: "Waiting for you", value: incoming.length, tone: incoming.length ? "warn" : undefined },
            { label: "Sent by you", value: sent.length },
          ]} />
        </AsideCard>
        <AsideCard title="What happens if…">
          <ul>
            <li><ShieldCheck size={16} aria-hidden /> <span><b>I give a site away?</b> Nothing moves until they accept, and you can cancel until then.</span></li>
            <li><ShieldCheck size={16} aria-hidden /> <span><b>They accept?</b> They own its pages, orders and web addresses. It leaves your account.</span></li>
            <li><ShieldCheck size={16} aria-hidden /> <span><b>I bring a site in?</b> Your old site stays where it is until you switch your address over.</span></li>
          </ul>
        </AsideCard>
        </>
      }
    >
      {error ? <GateOrError error={error}><Notice tone="bad">{error}</Notice></GateOrError> : null}

      {incoming.length ? (
        <Panel tone="tint" title="Someone wants to give you a site" description="Have a look, then accept or decline." data-tour="move-incoming">
          {incoming.map((t) => (
            <div key={t.id} className="plx-actionrow">
              <div>
                <b>{t.siteName}</b>
                <span>From {t.fromName}. Answer by {day(t.expiresAt)}.</span>
              </div>
              <ButtonLink href={`/dashboard/transfers/${t.id}`} rightIcon={<ArrowRight size={18} aria-hidden />}>Take a look</ButtonLink>
            </div>
          ))}
        </Panel>
      ) : null}

      <Panel title="Bring a site in" description="Move a site you already have, without starting again." data-tour="move-import">
        <div className="plx-sform plx-sform--wide">
          <div className="plx-way">
            <span className="plx-tile"><Download size={20} aria-hidden /></span>
            <div className="plx-actionrow" style={{ border: 0, padding: 0, flex: 1 }}>
              <div>
                <b>From WordPress</b>
                <span>We copy your pages, posts and pictures, and help you switch your address over safely.</span>
              </div>
              <ButtonLink href="/dashboard/migrate/wordpress" variant="secondary">Start</ButtonLink>
            </div>
          </div>
          <div className="plx-way">
            <span className="plx-tile"><Globe size={20} aria-hidden /></span>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <b style={{ display: "block", fontSize: 15 }}>From another website builder</b>
                <span className="plx-small">Wix, Squarespace, Webflow and others. Just paste your site&apos;s address.</span>
              </div>
              {sites.length ? (
                <div className="plx-searchrow">
                  <Select label="Which Plexo site should it go into?" value={importInto} onChange={(e) => setImportInto(e.target.value)} options={sites.map((s) => ({ value: s.id, label: s.name }))} />
                  <ButtonLink href={`/dashboard/templates/${importInto}/site-import`} variant="secondary">Bring it in</ButtonLink>
                </div>
              ) : (
                <p className="plx-small" style={{ margin: 0 }}>Make a site first, then bring your pages into it.</p>
              )}
            </div>
          </div>
          {!canImport ? <UpgradePrompt tone="info" requiredPlan="STARTER" message="Bringing a site in from another builder is part of the Starter plan." /> : null}
        </div>
      </Panel>

      {sent.length ? (
        <Panel title="Waiting for an answer" description="Sites you've offered that haven't been accepted yet.">
          {sent.map((t) => (
            <div key={t.id} className="plx-actionrow">
              <div>
                <b>{t.siteName}</b>
                <span>Sent to {t.toEmail} on {day(t.createdAt)}. <Badge tone="warning">Waiting</Badge></span>
              </div>
              {isOwner ? <Button variant="ghost" loading={busy === t.id} onClick={() => cancel(t)}>Cancel</Button> : null}
            </div>
          ))}
        </Panel>
      ) : null}

      <Panel title="Give a site to someone" description="They need a Plexo account, or they can make one. You stay in charge until they accept." data-tour="move-give">
        {!isOwner ? (
          <Notice tone="warn">Only the owner of the account can give a site away.</Notice>
        ) : sites.length === 0 ? (
          <p className="plx-body">You don&apos;t have a site to give yet.</p>
        ) : (
          <div className="plx-sform">
            <Select label="Which site?" value={siteId} onChange={(e) => { setSiteId(e.target.value); setPreview(null); }} options={sites.map((s) => ({ value: s.id, label: s.name }))} />
            <Input label="Their email" type="email" inputMode="email" value={email} onChange={(e) => { setEmail(e.target.value); setPreview(null); }} placeholder="name@example.com" help="We'll email them to ask. Nothing moves yet." />
            {!preview ? (
              <div><Button variant="secondary" loading={busy === "check"} disabled={!email.trim()} onClick={check}>Continue</Button></div>
            ) : (
              <div className="plx-safe" role="group" aria-label="Before you send">
                <h3 className="plx-h3" style={{ margin: 0, display: "flex", gap: 8, alignItems: "center" }}><ShieldCheck size={20} aria-hidden /> Before you send {site?.name}</h3>
                {!preview.exists ? <Notice>They don&apos;t have a Plexo account yet. We&apos;ll email them an invitation to make one.</Notice> : null}
                {preview.warnings.map((w) => (
                  <Notice key={w.title} tone="warn"><span><b>{w.title}.</b> {w.detail}</span></Notice>
                ))}
                {SAFETY.map((line, i) => (
                  <label key={line}>
                    <input type="checkbox" checked={ticks[i]} onChange={(e) => setTicks((p) => p.map((v, j) => (j === i ? e.target.checked : v)))} />
                    <span>{line}</span>
                  </label>
                ))}
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <Button loading={busy === "send"} disabled={!allTicked} leftIcon={<Send size={16} aria-hidden />} onClick={send}>Send to {email.trim()}</Button>
                  <Button variant="ghost" onClick={() => setPreview(null)}>Go back</Button>
                </div>
              </div>
            )}
          </div>
        )}
      </Panel>
    </SettingsPageShell>
  );
}
