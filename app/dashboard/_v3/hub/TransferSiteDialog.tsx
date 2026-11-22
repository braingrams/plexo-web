"use client";

import { useEffect, useState } from "react";
import { Send, ShieldCheck, UserCheck } from "lucide-react";
import { Badge, Button, Input, Modal, Notice, useToast } from "../ui";
import { GateOrError } from "@/app/dashboard/_components/UpgradePrompt";
import { errMsg, hubApi } from "./hubApi";
import type { HubFrameSite } from "./HubFrame";

type Warning = { title: string; detail: string };

type PendingTransfer = {
  id: string;
  templateId: string;
  siteName: string;
  toEmail: string;
  createdAt: string;
};

const SAFETY = [
  "I know this site will leave my account if they accept.",
  "I know they will own its pages, orders and web addresses.",
  "I've told them it's coming, and I trust them with it.",
];

export function TransferSiteDialog({
  site,
  onClose,
  onTransferSent,
}: {
  site: HubFrameSite | null;
  onClose: () => void;
  onTransferSent?: () => void;
}) {
  const { show } = useToast();
  const [email, setEmail] = useState("");
  const [checking, setChecking] = useState(false);
  const [sending, setSending] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [loadingPending, setLoadingPending] = useState(false);
  const [pending, setPending] = useState<PendingTransfer | null>(null);
  const [preview, setPreview] = useState<{ exists: boolean; warnings: Warning[] } | null>(null);
  const [ticks, setTicks] = useState<boolean[]>(SAFETY.map(() => false));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!site) {
      setEmail("");
      setPreview(null);
      setError(null);
      setPending(null);
      setTicks(SAFETY.map(() => false));
      return;
    }

    let active = true;
    setLoadingPending(true);
    hubApi<{ pending: PendingTransfer | null }>(`/api/templates/${site.id}/transfer`, { method: "GET" })
      .then((res) => {
        if (active) setPending(res.pending);
      })
      .catch(() => {
        // Non-fatal if pending lookup fails
      })
      .finally(() => {
        if (active) setLoadingPending(false);
      });

    return () => {
      active = false;
    };
  }, [site?.id]);

  const allTicked = ticks.every(Boolean);

  async function check() {
    if (!site) return;
    setError(null);
    setPreview(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return setError("Please type the email address of the person you're giving the site to.");
    }
    setChecking(true);
    try {
      const d = await hubApi<{ recipientExists: boolean; warnings?: Warning[] }>(
        `/api/templates/${site.id}/transfer`,
        { method: "POST", json: { toEmail: email.trim() } },
        "We couldn't check that recipient. Please try again.",
      );
      setPreview({ exists: d.recipientExists, warnings: d.warnings ?? [] });
      setTicks(SAFETY.map(() => false));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setChecking(false);
    }
  }

  async function send() {
    if (!site) return;
    setSending(true);
    setError(null);
    try {
      const d = await hubApi<{ request: PendingTransfer }>(
        `/api/templates/${site.id}/transfer`,
        { method: "POST", json: { toEmail: email.trim(), confirm: true } },
        "We couldn't send the transfer invite. Please try again.",
      );
      setPending(d.request);
      setPreview(null);
      setEmail("");
      show({
        title: "Invite sent",
        description: "Nothing moves until they accept. You stay in charge and can cancel until then.",
        tone: "success",
      });
      onTransferSent?.();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSending(false);
    }
  }

  async function cancelPending() {
    if (!site || !pending) return;
    setCancelling(true);
    setError(null);
    try {
      await hubApi(`/api/templates/${site.id}/transfer`, { method: "DELETE" }, "We couldn't cancel that. Please try again.");
      setPending(null);
      show({ title: "Cancelled", tone: "info" });
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setCancelling(false);
    }
  }

  if (!site) return null;

  return (
    <Modal
      open={!!site}
      onClose={() => (checking || sending || cancelling ? undefined : onClose())}
      title={pending ? "Waiting for them to accept" : `Give ${site.name} to someone`}
      description="They need a Plexo account, or they can make one. You stay in charge until they accept."
      footer={
        pending ? (
          <>
            <Button variant="ghost" onClick={onClose} disabled={cancelling}>
              Close
            </Button>
            <Button variant="danger" loading={cancelling} onClick={cancelPending}>
              Cancel offer
            </Button>
          </>
        ) : !preview ? (
          <>
            <Button variant="secondary" onClick={onClose} disabled={checking}>
              Cancel
            </Button>
            <Button loading={checking} disabled={!email.trim()} onClick={check}>
              Continue
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setPreview(null)} disabled={sending}>
              Go back
            </Button>
            <Button loading={sending} disabled={!allTicked} leftIcon={<Send size={16} aria-hidden />} onClick={send}>
              Send invite
            </Button>
          </>
        )
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {pending ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "14px 16px",
                borderRadius: "var(--plx-radius-sm, 8px)",
                background: "var(--plx-tint)",
                border: "1px solid var(--plx-border)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: "50%",
                    background: "var(--plx-surface)",
                    display: "grid",
                    placeItems: "center",
                    color: "var(--plx-deep)",
                    border: "1px solid var(--plx-border)",
                  }}
                >
                  <UserCheck size={16} aria-hidden />
                </span>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <b style={{ color: "var(--plx-heading)", fontSize: 13 }}>Waiting for them to accept</b>
                    <Badge tone="warning">Waiting</Badge>
                  </div>
                  <span className="plx-small" style={{ color: "var(--plx-muted)" }}>
                    Sent to {pending.toEmail}
                  </span>
                </div>
              </div>
            </div>
            <p className="plx-small" style={{ margin: 0, color: "var(--plx-muted)", lineHeight: 1.5 }}>
              We sent an invite to give them <b>{site.name}</b>. You stay in charge of this site until they accept. If you change your mind, cancel the offer above.
            </p>
          </div>
        ) : !preview ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Input
              label="Their email"
              type="email"
              inputMode="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && email.trim() && !checking) {
                  e.preventDefault();
                  void check();
                }
              }}
              placeholder="name@example.com"
              help="We'll email them to ask. Nothing moves yet."
              error={error ?? undefined}
              autoFocus
            />
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--plx-heading)" }}>
              <ShieldCheck size={18} aria-hidden style={{ color: "var(--plx-deep)" }} />
              <b style={{ fontSize: 14 }}>Before you give {site.name}</b>
            </div>

            {!preview.exists ? (
              <Notice kind="info" title="Invitation will be sent">
                They don&apos;t have a Plexo account yet. We&apos;ll email them an invitation to make one.
              </Notice>
            ) : null}

            {preview.warnings.map((w) => (
              <Notice key={w.title} kind="warning" title={w.title}>
                {w.detail}
              </Notice>
            ))}

            <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "8px 0" }}>
              {SAFETY.map((line, i) => (
                <label key={line} style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", fontSize: 13, color: "var(--plx-text)" }}>
                  <input
                    type="checkbox"
                    checked={ticks[i]}
                    onChange={(e) => setTicks((p) => p.map((v, j) => (j === i ? e.target.checked : v)))}
                    style={{ marginTop: 2 }}
                  />
                  <span>{line}</span>
                </label>
              ))}
            </div>

            {error ? (
              <GateOrError error={error}>
                <p className="plx-field__error" role="alert">
                  {error}
                </p>
              </GateOrError>
            ) : null}
          </div>
        )}
      </div>
    </Modal>
  );
}
