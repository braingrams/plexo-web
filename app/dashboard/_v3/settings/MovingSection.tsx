"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Download, Send, ShieldCheck } from "lucide-react";
import { Badge, Button, ButtonLink, Card, CardHeader, Input, Select, useToast } from "../ui";
import { errMsg, hubApi } from "../hub/hubApi";
import { Notice, SectionHead } from "./bits";

export type MoveSite = { id: string; name: string };
export type Incoming = { id: string; siteName: string; fromName: string; createdAt: string; expiresAt: string };
export type Outgoing = { id: string; templateId: string; siteName: string; toEmail: string; createdAt: string };
type Warning = { title: string; detail: string };

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

const SAFETY = [
  "I know this site will leave my account if they say yes.",
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
    <>
      <SectionHead title="Move a site">Give one of your sites to someone else, or bring a site in from somewhere else.</SectionHead>
      {error ? <Notice tone="bad">{error}</Notice> : null}

      {incoming.length ? (
        <Card tone="tint" data-tour="move-incoming">
          <CardHeader title="Someone wants to give you a site" description="Have a look, then say yes or no." />
          {incoming.map((t) => (
            <div key={t.id} className="plx-actionrow">
              <div>
                <b>{t.siteName}</b>
                <span>From {t.fromName}. Answer by {day(t.expiresAt)}.</span>
              </div>
              <ButtonLink href={`/dashboard/transfers/${t.id}`} rightIcon={<ArrowRight size={18} aria-hidden />}>Take a look</ButtonLink>
            </div>
          ))}
        </Card>
      ) : null}

      <div className="plx-set__grid">
        <Card data-tour="move-give">
          <CardHeader title="Give a site to someone" description="They need a Plexo account, or they can make one. You stay in charge until they say yes." />
          {!isOwner ? (
            <Notice tone="warn">Only the owner of the account can give a site away.</Notice>
          ) : sites.length === 0 ? (
            <p className="plx-body" style={{ margin: 0 }}>You don&apos;t have a site to give yet.</p>
          ) : (
            <div className="plx-form">
              <Select label="Which site?" value={siteId} onChange={(e) => { setSiteId(e.target.value); setPreview(null); }} options={sites.map((s) => ({ value: s.id, label: s.name }))} />
              <Input label="Their email" type="email" inputMode="email" value={email} onChange={(e) => { setEmail(e.target.value); setPreview(null); }} placeholder="name@example.com" />
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
        </Card>

        <Card data-tour="move-import">
          <CardHeader title="Bring a site in" description="Move a site you already have, without starting again." />
          <div className="plx-form">
            <div className="plx-actionrow" style={{ borderTop: 0, paddingTop: 0 }}>
              <div>
                <b>From WordPress</b>
                <span>We copy your pages, posts and pictures, and help you switch your address over safely.</span>
              </div>
              <ButtonLink href="/dashboard/migrate/wordpress" variant="secondary" leftIcon={<Download size={18} aria-hidden />}>Start</ButtonLink>
            </div>
            <div className="plx-actionrow">
              <div>
                <b>From another website builder</b>
                <span>Wix, Squarespace, Webflow and others. Just paste your site&apos;s address.</span>
              </div>
            </div>
            {sites.length ? (
              <>
                <Select label="Which Plexo site should it go into?" value={importInto} onChange={(e) => setImportInto(e.target.value)} options={sites.map((s) => ({ value: s.id, label: s.name }))} />
                <div><ButtonLink href={`/dashboard/templates/${importInto}/site-import`} variant="secondary">Bring it in</ButtonLink></div>
              </>
            ) : (
              <p className="plx-small" style={{ margin: 0 }}>Make a site first, then bring your pages into it.</p>
            )}
            {!canImport ? <Notice tone="warn">Bringing a site in is part of the Starter plan. <Link href="/dashboard/settings/plan" style={{ fontWeight: 700 }}>See plans</Link></Notice> : null}
          </div>
        </Card>
      </div>

      {sent.length ? (
        <Card>
          <CardHeader title="Waiting for an answer" />
          {sent.map((t) => (
            <div key={t.id} className="plx-actionrow">
              <div>
                <b>{t.siteName}</b>
                <span>Sent to {t.toEmail} on {day(t.createdAt)}. <Badge tone="warning">Waiting</Badge></span>
              </div>
              {isOwner ? <Button variant="ghost" loading={busy === t.id} onClick={() => cancel(t)}>Cancel</Button> : null}
            </div>
          ))}
        </Card>
      ) : null}
    </>
  );
}
