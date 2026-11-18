"use client";

import "./transfers.css";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, Gift } from "lucide-react";
import { siteHubHref } from "@/lib/dashboardV3/hubPaths";
import { Button, ButtonLink, Card, Notice } from "../ui";

type Warning = { title: string; detail: string };

const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });

/** Someone is handing you a site. Say who, what you get, and let them accept or say no. */
export function TransferOffer({
  id,
  siteName,
  fromName,
  fromEmail,
  fromOrgName,
  toEmail,
  status,
  createdAt,
  expiresAt,
  isRecipient,
  sessionEmail,
}: {
  id: string;
  siteName: string;
  fromName: string;
  fromEmail: string;
  fromOrgName: string;
  toEmail: string;
  status: string;
  createdAt: string;
  expiresAt: string;
  isRecipient: boolean;
  sessionEmail: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<Warning[] | null>(null);
  const [result, setResult] = useState<"ACCEPTED" | "DECLINED" | null>(null);

  async function respond(action: "accept" | "decline", acknowledgeWarnings = false) {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/site-transfers/${id}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, acknowledgeWarnings }),
      });
      const data = await res.json();
      if (res.status === 409 && data.requiresAcknowledgement) {
        setWarnings(data.warnings);
        return;
      }
      if (!res.ok) throw new Error(data.error ?? "We could not send your answer. Please try again.");
      setResult(data.status);
      if (data.status === "ACCEPTED" && data.templateId) setTimeout(() => router.push(siteHubHref(data.templateId)), 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "We could not send your answer. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  const back = (
    <ButtonLink href="/dashboard/settings/moving" variant="ghost" size="sm" leftIcon={<ArrowLeft size={16} aria-hidden />}>
      Moving sites
    </ButtonLink>
  );

  if (!isRecipient) {
    return (
      <div className="plx-page plx-xfer">
        <div>{back}</div>
        <Card padding="lg">
          <h1 className="plx-h2">{siteName}</h1>
          <p className="plx-body" style={{ marginTop: 10 }}>
            This was sent to <b>{toEmail}</b>, but you are signed in as {sessionEmail}. Sign in with {toEmail} to answer it.
          </p>
        </Card>
      </div>
    );
  }

  if (status !== "PENDING" || result) {
    const final = result ?? status;
    return (
      <div className="plx-page plx-xfer">
        <div>{back}</div>
        <Card padding="lg">
          <h1 className="plx-h2">{siteName}</h1>
          {final === "ACCEPTED" ? (
            <p className="plx-xfer__done" role="status">
              <CheckCircle2 size={20} aria-hidden /> This site is now yours. Taking you to it…
            </p>
          ) : (
            <p className="plx-body" style={{ marginTop: 10 }}>
              {final === "DECLINED" ? "You said no to this one." : final === "EXPIRED" ? "This offer ran out of time." : final === "CANCELED" || final === "CANCELLED" ? "The sender took this offer back." : "This offer is no longer open."}
            </p>
          )}
        </Card>
      </div>
    );
  }

  return (
    <div className="plx-page plx-xfer">
      <div>{back}</div>
      <Card padding="lg" className="plx-xfer__card">
        <span className="plx-xfer__icon" aria-hidden>
          <Gift size={26} />
        </span>
        <p className="plx-eyebrow">A site is being handed to you</p>
        <h1 className="plx-h1">{siteName}</h1>
        <p className="plx-body">
          <b>{fromName}</b> ({fromEmail}) from <b>{fromOrgName}</b> wants to give you this site, with all its pages and, if it has one, its store with products and orders.
        </p>
        <p className="plx-small">Sent {when(createdAt)}. You can answer until {when(expiresAt)}.</p>

        {warnings && warnings.length > 0 ? (
          <div className="plx-xfer__warn">
            <Notice kind="warning" title={`${warnings.length} ${warnings.length === 1 ? "thing" : "things"} to know about your plan`}>
              The site moves over complete either way. These are only things that may not work fully on your plan.
            </Notice>
            <ul>
              {warnings.map((w, i) => (
                <li key={i}>
                  <b>{w.title}</b>
                  <span>{w.detail}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {error ? <Notice kind="error" title="That did not work">{error}</Notice> : null}

        <div className="plx-xfer__acts">
          <Button size="lg" onClick={() => void respond("accept", warnings !== null)} loading={busy === "accept"} loadingLabel="Accepting" disabled={busy !== null}>
            {warnings ? "Accept anyway" : "Accept this site"}
          </Button>
          <Button size="lg" variant="secondary" onClick={() => void respond("decline")} loading={busy === "decline"} loadingLabel="Declining" disabled={busy !== null}>
            No thanks
          </Button>
        </div>
      </Card>
    </div>
  );
}
