"use client";

import { ExternalLink, Eye } from "lucide-react";
import { liveHref, OPEN_SITE_HINT, previewHref } from "@/lib/dashboardV3/siteLinks";
import { Button, ButtonLink, type ButtonSize, type ButtonVariant } from "../ui";

type SiteLike = { id: string; status?: "live" | "draft" | string | null; address?: string | null };

/** "Preview": a private look at the working copy (what visitors will see after the next publish). Never the live site. */
export function PreviewButton({ site, size, variant = "secondary", style, className }: { site: SiteLike; size?: ButtonSize; variant?: ButtonVariant; style?: React.CSSProperties; className?: string }) {
  return (
    <ButtonLink href={previewHref(site.id)} target="_blank" rel="noopener noreferrer" variant={variant} size={size} leftIcon={<Eye size={16} aria-hidden />} style={style} className={className}>
      Preview
    </ButtonLink>
  );
}

/**
 * "Open my site": the live address, in a new tab. Only works when the site is online and has an address;
 * otherwise it is shown disabled with a plain hint (never a link to the preview).
 */
export function OpenSiteButton({ site, size, variant = "secondary", style, className }: { site: SiteLike; size?: ButtonSize; variant?: ButtonVariant; style?: React.CSSProperties; className?: string }) {
  const href = liveHref(site);
  if (href) {
    return (
      <ButtonLink href={href} target="_blank" rel="noopener noreferrer" variant={variant} size={size} rightIcon={<ExternalLink size={16} aria-hidden />} style={style} className={className}>
        Open my site
      </ButtonLink>
    );
  }
  return (
    <Button variant={variant} size={size} disabled title={OPEN_SITE_HINT} aria-label={`Open my site. ${OPEN_SITE_HINT}.`} rightIcon={<ExternalLink size={16} aria-hidden />} style={style} className={className}>
      Open my site
    </Button>
  );
}

/** Compact, icon-only "Preview" (private look at the working copy), for cards where text buttons would crowd the card. */
export function PreviewIconButton({ site }: { site: SiteLike }) {
  return (
    <ButtonLink href={previewHref(site.id)} target="_blank" rel="noopener noreferrer" variant="secondary" iconOnly title="Preview (private look at what you have so far)" aria-label="Preview this site" className="plx-siteicon">
      <Eye size={18} aria-hidden />
    </ButtonLink>
  );
}

/** Compact, icon-only "Open my site" (the live address, new tab). Disabled with the plain hint until the site is online. */
export function OpenSiteIconButton({ site }: { site: SiteLike }) {
  const href = liveHref(site);
  if (href) {
    return (
      <ButtonLink href={href} target="_blank" rel="noopener noreferrer" variant="secondary" iconOnly title="Open my site (live)" aria-label="Open my site in a new tab" className="plx-siteicon">
        <ExternalLink size={18} aria-hidden />
      </ButtonLink>
    );
  }
  return (
    <Button variant="secondary" iconOnly disabled title={OPEN_SITE_HINT} aria-label={`Open my site. ${OPEN_SITE_HINT}.`} className="plx-siteicon">
      <ExternalLink size={18} aria-hidden />
    </Button>
  );
}
