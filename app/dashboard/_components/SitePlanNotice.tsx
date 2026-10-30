"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { startTrial } from "./trial";

// A slim strip at the top of the site and app editors saying what the owner's plan means
// for THIS site, with the one action that fixes it. Silent whenever there's nothing to say
// (every paid plan, and a Free site that's live and only has its homepage).

type SiteStatus = {
  plan: "FREE" | "PRO" | "ULTRA";
  previousPlan: "PRO" | "ULTRA" | null;
  trialAvailable: boolean;
  homeOnly: boolean;
  isApp: boolean;
  site: { id: string; name: string; isLive: boolean; liveAddress: string | null; pausedCustomDomains: string[]; everPublished: boolean } | null;
  otherLiveSite: { id: string; name: string } | null;
  pageCount: number;
  unpublishedPageCount: number;
  archivedByPlanPageCount: number;
  secondaryLinks: { href: string; label: string }[];
};

const PLAN_NAME = { PRO: "Pro", ULTRA: "Ultra" } as const;

export function SitePlanNotice({ templateId, refreshKey }: { templateId: string; refreshKey?: unknown }) {
  const [status, setStatus] = useState<SiteStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [linksOpen, setLinksOpen] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/v1/plan/site?templateId=${encodeURIComponent(templateId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: SiteStatus | null) => setStatus(data))
      .catch(() => {});
  }, [templateId]);

  useEffect(load, [load, refreshKey]);

  if (!status || !status.homeOnly || !status.site) return null;

  const previous = status.previousPlan ? PLAN_NAME[status.previousPlan] : "Pro";
  const upgradeHref = `/dashboard/settings/subscription?upgrade=${status.previousPlan ?? "PRO"}`;

  async function makeLive(): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/v1/plan/live-site", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; liveAddress?: string | null };
      if (!res.ok) throw new Error(data.error ?? "Couldn't switch your live site.");
      setMessage(data.liveAddress ? `Live at ${data.liveAddress}` : "This is now your live site.");
      load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Couldn't switch your live site.");
    } finally {
      setBusy(false);
    }
  }

  const trialPlan = status.previousPlan ?? "PRO";
  // With the free trial still unused, every upgrade button here starts it instead (no card).
  const Upgrade = ({ label }: { label: string }) =>
    status.trialAvailable ? (
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void startTrial(trialPlan).catch((err) => {
            setMessage(err instanceof Error ? err.message : "Couldn't start your trial.");
            setBusy(false);
          });
        }}
        style={{ ...primaryButton, border: "none", cursor: "pointer", fontFamily: "inherit" }}
      >
        {busy ? "Starting…" : `Try ${PLAN_NAME[trialPlan]} free for 14 days`}
      </button>
    ) : (
      <Link href={upgradeHref} style={primaryButton}>{label}</Link>
    );

  const notices: React.ReactNode[] = [];

  // 1. This site is offline because Free keeps one site live and another one is.
  if (!status.site.isLive && (status.site.everPublished || status.otherLiveSite)) {
    notices.push(
      <Strip key="offline" tone="warning">
        <span>
          <strong>This {status.isApp ? "app" : "site"} is offline.</strong>{" "}
          {status.otherLiveSite
            ? <>The Free plan keeps one site live, and <strong>{status.otherLiveSite.name}</strong> is live now.</>
            : <>The Free plan keeps one site live on a Plexo address.</>}
          {status.site.pausedCustomDomains.length > 0 && <> Your domain {status.site.pausedCustomDomains[0]} is paused, not removed.</>}
        </span>
        <span style={actions}>
          <button type="button" onClick={() => void makeLive()} disabled={busy} style={secondaryButton}>
            {busy ? "Switching…" : "Make this my live site"}
          </button>
          <Upgrade label={"Upgrade to keep both"} />
        </span>
      </Strip>,
    );
  } else if (status.site.isLive && status.site.pausedCustomDomains.length > 0) {
    notices.push(
      <Strip key="domain" tone="info">
        <span>
          Live at <strong>{status.site.liveAddress}</strong>. Your domain <strong>{status.site.pausedCustomDomains[0]}</strong> is paused on the Free plan — it comes back the moment you upgrade.
        </span>
        <span style={actions}>
          <Upgrade label={"Bring back my domain"} />
        </span>
      </Strip>,
    );
  }

  // 2. Secondary pages kept from a paid plan (the exact wording the Free tier promises).
  if (!status.isApp && status.pageCount > 1) {
    notices.push(
      <Strip key="pages" tone="info">
        <span>
          {status.previousPlan
            ? <>Your site contains secondary pages archived from your {previous} plan. Reactivate {previous} to publish them, or keep only 1 page to continue editing on the Free tier.</>
            : <>You can build and preview every page, but the Free plan publishes only your homepage — visitors can't open the others yet. Upgrade to Pro to put them live.</>}
        </span>
        <span style={actions}>
          <Upgrade label={status.previousPlan ? `Reactivate ${previous}` : "Upgrade to Pro"} />
        </span>
      </Strip>,
    );
  }

  // 3. An app on Free answers its first screen only.
  if (status.isApp && status.site.isLive) {
    notices.push(
      <Strip key="app" tone="info">
        <span>On the Free plan visitors see your app&apos;s first screen. Other screens send them back to it.</span>
        <span style={actions}>
          <Upgrade label={"Upgrade to open every screen"} />
        </span>
      </Strip>,
    );
  }

  // 4. Links on the homepage that lead to pages Free doesn't publish.
  if (status.secondaryLinks.length > 0) {
    const shown = status.secondaryLinks.slice(0, 3).map((l) => l.label).join(", ");
    const more = status.secondaryLinks.length > 3 ? ` and ${status.secondaryLinks.length - 3} more` : "";
    notices.push(
      <Strip key="links" tone="warning">
        <span>
          <strong>{status.secondaryLinks.length} link{status.secondaryLinks.length === 1 ? "" : "s"} on this page lead{status.secondaryLinks.length === 1 ? "s" : ""} to other pages</strong> ({shown}{more}).
          On the Free plan those pages aren&apos;t published, so visitors who click them land back on this homepage.
          {linksOpen && (
            <span style={{ display: "block", marginTop: 6, color: "rgba(240,242,255,0.6)" }}>
              {status.secondaryLinks.map((l) => `${l.label} → ${l.href}`).join("  ·  ")}
            </span>
          )}
        </span>
        <span style={actions}>
          <button type="button" onClick={() => setLinksOpen((v) => !v)} style={secondaryButton}>
            {linksOpen ? "Hide links" : "Show links"}
          </button>
          <Upgrade label={"Publish those pages"} />
        </span>
      </Strip>,
    );
  }

  if (notices.length === 0 && !message) return null;
  return (
    <div style={{ flexShrink: 0 }}>
      {notices}
      {message && (
        <div role="status" style={{ padding: "0.45rem 1.1rem", fontSize: "0.78rem", color: "#c4b5fd", background: "rgba(var(--brand-rgb),0.08)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          {message}
        </div>
      )}
    </div>
  );
}

function Strip({ tone, children }: { tone: "info" | "warning"; children: React.ReactNode }) {
  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "0.75rem",
        flexWrap: "wrap",
        padding: "0.55rem 1.1rem",
        fontSize: "0.8rem",
        lineHeight: 1.5,
        color: tone === "warning" ? "#fde68a" : "#ddd6fe",
        background: tone === "warning" ? "rgba(245,183,74,0.08)" : "rgba(var(--brand-rgb),0.08)",
        borderBottom: `1px solid ${tone === "warning" ? "rgba(245,183,74,0.22)" : "rgba(var(--brand-rgb),0.22)"}`,
      }}
    >
      {children}
    </div>
  );
}

const actions: React.CSSProperties = { display: "inline-flex", gap: "0.5rem", flexShrink: 0, alignItems: "center" };

const primaryButton: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "0.35rem 0.8rem",
  borderRadius: 8,
  fontSize: "0.76rem",
  fontWeight: 700,
  textDecoration: "none",
  background: "var(--brand)",
  color: "#fff",
  whiteSpace: "nowrap",
};

const secondaryButton: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "0.35rem 0.8rem",
  borderRadius: 8,
  fontSize: "0.76rem",
  fontWeight: 700,
  border: "1px solid rgba(255,255,255,0.18)",
  background: "transparent",
  color: "inherit",
  cursor: "pointer",
  whiteSpace: "nowrap",
  fontFamily: "inherit",
};
