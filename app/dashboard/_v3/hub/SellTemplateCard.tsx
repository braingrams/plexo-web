"use client";

import Link from "next/link";
import { ArrowRight, BadgeDollarSign, Tag } from "lucide-react";
import { ButtonLink } from "../ui";

export type SellTemplateCardProps = {
  siteId: string;
  siteName: string;
};

/**
 * Proper card for selling a site design on the marketplace to earn money.
 */
export function SellTemplateCard({ siteId, siteName }: SellTemplateCardProps) {
  const sellHref = `/dashboard/marketplace/sell?templateId=${encodeURIComponent(siteId)}`;

  return (
    <section aria-labelledby="sell-template-heading" className="plx-sell-card-wrap">
      <div
        style={{
          border: "1px solid var(--plx-border)",
          borderRadius: "var(--plx-radius-card-lg, 16px)",
          background: "var(--plx-surface)",
          padding: "28px 32px",
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 24,
          flexWrap: "wrap",
          boxShadow: "var(--plx-shadow-card)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 20, maxWidth: 660 }}>
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: 16,
              background: "color-mix(in srgb, var(--plx-brand) 18%, transparent)",
              color: "var(--plx-deep, var(--plx-brand))",
              display: "grid",
              placeItems: "center",
              flexShrink: 0,
            }}
            aria-hidden
          >
            <BadgeDollarSign size={28} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <h2
                id="sell-template-heading"
                style={{
                  fontSize: 20,
                  fontWeight: 800,
                  margin: 0,
                  letterSpacing: "-0.015em",
                  color: "var(--plx-text)",
                }}
              >
                Sell this template to earn
              </h2>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  padding: "2px 8px",
                  borderRadius: 999,
                  background: "var(--plx-tint)",
                  color: "var(--plx-deep)",
                  border: "1px solid var(--plx-border)",
                }}
              >
                Marketplace
              </span>
            </div>
            <p
              style={{
                fontSize: 15,
                lineHeight: 1.5,
                color: "var(--plx-muted)",
                margin: 0,
              }}
            >
              Turn &ldquo;{siteName}&rdquo; into a reusable template for creators and businesses worldwide.
              Earn money on every sale with creator royalties.
            </p>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <ButtonLink
            href={sellHref}
            variant="primary"
            leftIcon={<Tag size={16} />}
            rightIcon={<ArrowRight size={16} />}
          >
            Sell this template
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}
