"use client";

import Link from "next/link";
import { ArrowRight, BadgeDollarSign, Download, Layers, LayoutGrid, Store, Wallet, Zap } from "lucide-react";
import { ButtonLink, Card } from "../ui";
import { SellTemplateCard } from "./SellTemplateCard";
import { AddMoreCards } from "./AddMore";
import type { HubFrameSite } from "./HubFrame";
import type { HubFeatures } from "@/lib/dashboardV3/hubTabs";
import type { ExamplePage } from "@/lib/dashboardV3/addMoreExamples";

export function MoreTab({
  site,
  features,
  pages = [],
  experience,
}: {
  site: HubFrameSite;
  features: HubFeatures;
  pages?: ExamplePage[];
  experience: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 36, paddingBottom: 64 }}>
      {/* 1. Add More to Your Site Section */}
      <AddMoreCards
        siteId={site.id}
        siteName={site.name}
        features={features}
        pages={pages}
      />

      {/* 2. Template Marketplace & Monetization Section */}
      <section aria-labelledby="marketplace-monetization-heading" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <h2 id="marketplace-monetization-heading" className="plx-h2">
            Marketplace &amp; Monetization
          </h2>
          <p className="plx-hub__sub">
            Share your custom designs with thousands of creators and businesses.
          </p>
        </div>

        <SellTemplateCard siteId={site.id} siteName={site.name} />

        {/* Quick links to Marketplace management */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 16,
            marginTop: 4,
          }}
        >
          <Card padding="md">
            <Link
              href="/dashboard/marketplace"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                textDecoration: "none",
                color: "var(--plx-text)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <span
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 10,
                    background: "var(--plx-tint)",
                    color: "var(--plx-deep)",
                    display: "grid",
                    placeItems: "center",
                  }}
                  aria-hidden
                >
                  <Store size={20} />
                </span>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <b style={{ fontSize: 14, fontWeight: 700 }}>Browse marketplace</b>
                  <span style={{ fontSize: 12, color: "var(--plx-muted)" }}>Explore templates and designs</span>
                </div>
              </div>
              <ArrowRight size={16} style={{ color: "var(--plx-muted)" }} />
            </Link>
          </Card>

          <Card padding="md">
            <Link
              href="/dashboard/marketplace/listings"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                textDecoration: "none",
                color: "var(--plx-text)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <span
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 10,
                    background: "var(--plx-tint)",
                    color: "var(--plx-deep)",
                    display: "grid",
                    placeItems: "center",
                  }}
                  aria-hidden
                >
                  <Layers size={20} />
                </span>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <b style={{ fontSize: 14, fontWeight: 700 }}>Your listings</b>
                  <span style={{ fontSize: 12, color: "var(--plx-muted)" }}>Manage templates you are selling</span>
                </div>
              </div>
              <ArrowRight size={16} style={{ color: "var(--plx-muted)" }} />
            </Link>
          </Card>

          <Card padding="md">
            <Link
              href="/dashboard/marketplace/payouts"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                textDecoration: "none",
                color: "var(--plx-text)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <span
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 10,
                    background: "var(--plx-tint)",
                    color: "var(--plx-deep)",
                    display: "grid",
                    placeItems: "center",
                  }}
                  aria-hidden
                >
                  <Wallet size={20} />
                </span>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <b style={{ fontSize: 14, fontWeight: 700 }}>Earnings &amp; Payouts</b>
                  <span style={{ fontSize: 12, color: "var(--plx-muted)" }}>Track revenue and cash out</span>
                </div>
              </div>
              <ArrowRight size={16} style={{ color: "var(--plx-muted)" }} />
            </Link>
          </Card>
        </div>
      </section>
    </div>
  );
}
