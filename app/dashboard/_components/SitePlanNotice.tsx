"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Info, X } from "lucide-react";
import { startTrial } from "./trial";
import { upgradeHref as planUpgradeHref } from "@/lib/plan/planGate";
import { PLAN_LABELS, PLAN, type PaidPlanId, type TrialPlanId } from "@/lib/plan/plans";
import { buildSiteNotices, dismissKey, planFor, stripHeadline, type SiteNotice, type SiteNoticeStatus } from "@/lib/plan/siteNotices";

// ONE calm strip at the top of the site and app editors saying what the owner's plan means for THIS site. It never stacks:
// a short sentence, a "Details" button that opens a friendly list (with "Show links" and the one upgrade action), and a
// close button that hides it for this visit. Silent whenever there's nothing to say (every paid plan, and a Free site
// that's live and only has its homepage). The wording lives in lib/plan/siteNotices.ts.

const line = "color-mix(in srgb, var(--plx-text, #fff) 12%, transparent)";

export function SitePlanNotice({ templateId, refreshKey }: { templateId: string; refreshKey?: unknown }) {
  const [status, setStatus] = useState<SiteNoticeStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [linksFor, setLinksFor] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      setDismissed(window.sessionStorage.getItem(dismissKey(templateId)) === "1");
    } catch {}
  }, [templateId]);

  const load = useCallback(() => {
    fetch(`/api/v1/plan/site?templateId=${encodeURIComponent(templateId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: SiteNoticeStatus | null) => setStatus(data))
      .catch(() => {});
  }, [templateId]);

  useEffect(load, [load, refreshKey]);

  // Esc and clicking elsewhere close the details.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  if (!status) return null;
  const notices = buildSiteNotices(status);
  if (notices.length === 0 && !message) return null;
  if (dismissed && !message) return null;

  async function makeLive(): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/v1/plan/live-site", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ templateId }) });
      const data = (await res.json().catch(() => ({}))) as { error?: string; liveAddress?: string | null };
      if (!res.ok) throw new Error(data.error ?? "We couldn't make this your live site. Try again in a moment.");
      setMessage(data.liveAddress ? `Live at ${data.liveAddress}` : "This is now your live site.");
      load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "We couldn't make this your live site. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  const dismiss = () => {
    setOpen(false);
    setDismissed(true);
    try {
      window.sessionStorage.setItem(dismissKey(templateId), "1");
    } catch {}
  };

  // With the free trial still unused, the upgrade button starts it instead (no card needed).
  const Upgrade = ({ notice, compact }: { notice: SiteNotice; compact?: boolean }) => {
    const target = planFor(status, notice.need);
    const trialPlan: TrialPlanId = target === PLAN.STARTER ? PLAN.STARTER : PLAN.PRO;
    const style = compact ? { ...primaryButton, minHeight: 36 } : primaryButton;
    return status.trialAvailable ? (
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void startTrial(trialPlan).catch((err) => {
            setMessage(err instanceof Error ? err.message : "We couldn't start your free trial. Try again in a moment.");
            setBusy(false);
          });
        }}
        style={style}
      >
        {busy ? "Starting…" : `Try ${PLAN_LABELS[trialPlan]} free for 14 days`}
      </button>
    ) : (
      <Link href={planUpgradeHref(target, typeof window === "undefined" ? `/dashboard/templates/${templateId}` : window.location.pathname + window.location.search)} style={style}>
        {notice.upgradeLabel}
      </Link>
    );
  };

  const first = notices[0];
  return (
    <div ref={box} style={{ position: "relative", flexShrink: 0, zIndex: 40 }}>
      <style>{"@media (max-width: 640px) { .plx-notice-upgrade { display: none !important; } }"}</style>
      <div role="status" style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 44, padding: "4px 12px", fontSize: "0.82rem", background: "color-mix(in srgb, var(--plx-text, #fff) 4%, transparent)", borderBottom: `1px solid ${line}`, color: "var(--plx-text, inherit)" }}>
        <Info size={16} aria-hidden style={{ flexShrink: 0, opacity: 0.7 }} />
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={message ?? stripHeadline(notices)}>
          {message ?? stripHeadline(notices)}
        </span>
        {first && (
          <>
            <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} style={{ ...ghostButton, flexShrink: 0 }}>
              {open ? "Close" : "Details"}
            </button>
            <span className="plx-notice-upgrade" style={{ display: "inline-flex", flexShrink: 0 }}>
              <Upgrade notice={first} compact />
            </span>
          </>
        )}
        <button type="button" onClick={dismiss} aria-label="Hide this message for now" title="Hide for now" style={{ ...ghostButton, width: 40, padding: 0, justifyContent: "center", flexShrink: 0 }}>
          <X size={16} aria-hidden />
        </button>
      </div>

      {open && first && (
        <div role="dialog" aria-label="About your plan" style={{ position: "absolute", top: "100%", right: 8, left: 8, marginInline: "auto 0", maxWidth: 460, marginTop: 6, padding: 16, borderRadius: 14, background: "var(--plx-surface, #14161f)", color: "var(--plx-text, #fff)", border: `1px solid ${line}`, boxShadow: "0 18px 40px rgba(0,0,0,.35)", display: "grid", gap: 14, maxHeight: "min(70vh, 480px)", overflowY: "auto" }}>
          {notices.map((n) => (
            <section key={n.key} style={{ display: "grid", gap: 6 }}>
              <strong style={{ fontSize: "0.9rem" }}>{n.headline}</strong>
              <p style={{ margin: 0, fontSize: "0.82rem", lineHeight: 1.55, opacity: 0.8 }}>{n.detail}</p>
              {n.links && linksFor && (
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: "0.8rem", lineHeight: 1.7 }}>
                  {n.links.map((l) => (
                    <li key={`${l.href}-${l.label}`}>
                      {l.label} <span style={{ opacity: 0.6 }}>({l.href})</span>
                    </li>
                  ))}
                </ul>
              )}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
                {n.links && (
                  <button type="button" onClick={() => setLinksFor((v) => !v)} style={ghostButton}>
                    {linksFor ? "Hide links" : "Show links"}
                  </button>
                )}
                {n.canMakeLive && (
                  <button type="button" onClick={() => void makeLive()} disabled={busy} style={ghostButton}>
                    {busy ? "Switching…" : "Make this my live site"}
                  </button>
                )}
                <Upgrade notice={n} />
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

const baseButton: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  minHeight: 40,
  padding: "0 14px",
  borderRadius: 10,
  fontSize: "0.8rem",
  fontWeight: 700,
  whiteSpace: "nowrap",
  fontFamily: "inherit",
  textDecoration: "none",
  cursor: "pointer",
};

const primaryButton: React.CSSProperties = { ...baseButton, border: "none", background: "var(--brand)", color: "var(--plx-on-brand, #fff)" };

const ghostButton: React.CSSProperties = {
  ...baseButton,
  border: `1px solid ${line}`,
  background: "transparent",
  color: "inherit",
};
