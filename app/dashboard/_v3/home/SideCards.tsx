"use client";

import { useState } from "react";
import { Check, Copy, Eye, Mail, MessageCircle, Pencil } from "lucide-react";
import { NEW_EMAIL_HREF, solEmailHref } from "@/lib/dashboardV3/emails";
import type { SiteSummary } from "@/lib/dashboardV3/sites";
import { Button, ButtonLink, Card, StatusPill } from "../ui";
import type { HomeBrand } from "./homeTypes";

export function siteHref(s: SiteSummary) {
  return s.address ? `https://${s.address}` : null;
}

/** What the site looks like right now, in the owner's own colour, with Edit and Preview. */
export function SitePreviewCard({ site, brand }: { site: SiteSummary; brand: HomeBrand }) {
  const href = siteHref(site);
  const initial = (site.name.trim()[0] ?? "S").toUpperCase();
  return (
    <Card padding="none" style={{ overflow: "hidden" }} data-tour="home-site-card">
      <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14, background: "var(--plx-elevated)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <StatusPill status={site.status} label={site.status === "live" ? "Online" : "Not online yet"} />
          <span className="plx-small">{site.kind}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {brand.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={brand.logoUrl} alt="" width={44} height={44} style={{ borderRadius: 12, objectFit: "cover", background: "var(--plx-surface)" }} />
          ) : (
            <span aria-hidden style={{ width: 44, height: 44, borderRadius: 12, display: "grid", placeItems: "center", fontWeight: 800, fontSize: 20, background: brand.color || "var(--plx-brand)", color: brand.color ? "white" : "var(--plx-on-brand)" }}>
              {initial}
            </span>
          )}
          <div style={{ minWidth: 0 }}>
            <div className="plx-h3" style={{ overflowWrap: "anywhere" }}>{site.name}</div>
            <div className="plx-small" style={{ overflowWrap: "anywhere" }}>{site.address ?? "No web address yet"}</div>
          </div>
        </div>
        <div aria-hidden style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          {[0, 1, 2].map((i) => (
            <span key={i} style={{ height: 36, borderRadius: 8, background: brand.color || "var(--plx-tint)", opacity: 0.25 + i * 0.2 }} />
          ))}
        </div>
      </div>
      <div style={{ padding: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <ButtonLink href={`/dashboard/sites/${site.id}`} variant="strong" leftIcon={<Pencil size={16} aria-hidden />} style={{ flex: "1 1 130px" }}>
          Edit site
        </ButtonLink>
        {/* Online: the real site. Not online yet: a private preview of what you have so far, never the editor again. */}
        <ButtonLink href={href ?? `/api/v1/templates/${site.id}/draft-preview`} target="_blank" rel="noopener noreferrer" variant="secondary" leftIcon={<Eye size={16} aria-hidden />} style={{ flex: "1 1 130px" }}>
          Preview
        </ButtonLink>
      </div>
    </Card>
  );
}

export function AskSolCard({ prompt }: { prompt: string }) {
  return (
    <Card data-tour="home-ask-sol" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <span className="plx-h3">Ask SOL</span>
      <span className="plx-body">“{prompt}” SOL builds it for you and asks before guessing.</span>
      <ButtonLink href="/dashboard/sol" variant="secondary" leftIcon={<MessageCircle size={18} aria-hidden />}>
        Tell SOL what you want
      </ButtonLink>
    </Card>
  );
}

/** Copies the site's link and says so. */
export function CopyLinkButton({ address, variant = "secondary" }: { address?: string | null; variant?: "secondary" | "strong" }) {
  const [copied, setCopied] = useState(false);
  if (!address) return null;
  return (
    <Button
      variant={variant}
      leftIcon={copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(`https://${address}`);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2500);
        } catch {
          window.prompt("Copy your link", `https://${address}`);
        }
      }}
    >
      {copied ? "Link copied" : "Copy link"}
    </Button>
  );
}

/** A quick way to make an email without opening the menu: a welcome note, a receipt, a newsletter. */
export function MakeEmailCard() {
  return (
    <Card data-tour="home-make-email" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <span className="plx-h3">Make an email</span>
      <span className="plx-body">A welcome note, a receipt or a newsletter. Start blank, from a design, or let SOL write it.</span>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <ButtonLink href={NEW_EMAIL_HREF} variant="secondary" leftIcon={<Mail size={18} aria-hidden />}>Make an email</ButtonLink>
        <ButtonLink href={solEmailHref()} variant="ghost" leftIcon={<MessageCircle size={18} aria-hidden />}>Ask SOL to write it</ButtonLink>
      </div>
    </Card>
  );
}
