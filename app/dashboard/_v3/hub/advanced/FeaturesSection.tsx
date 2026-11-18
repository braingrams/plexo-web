"use client";

import { Badge, ButtonLink, Card } from "../../ui";
import { advancedHref, type AdvancedSectionId } from "@/lib/dashboardV3/hubAdvanced";
import { hubTabHref, type HubFeatures } from "@/lib/dashboardV3/hubTabs";

export type FeaturesData = { layoutEnabled: boolean; pageCount: number; submissionCount: number; contentTypeCount: number };

type Row = { title: string; help: string; on?: boolean; count?: number; countLabel?: string; href: string; action: string };

/** What this site has switched on, with one button each to change it. Nothing here leaves the hub except the shop's own settings. */
export function FeaturesSection({ siteId, features, data }: { siteId: string; features: HubFeatures; data: FeaturesData }) {
  const sec = (id: AdvancedSectionId) => advancedHref(siteId, id);
  const rows: Row[] = [
    { title: "Header and footer", help: "One header and footer shared by every page.", on: data.layoutEnabled, href: sec("layout"), action: data.layoutEnabled ? "Change" : "Set up" },
    { title: "Blog", help: "A place for news and stories.", on: features.blog, href: features.blog ? hubTabHref(siteId, "blog") : hubTabHref(siteId, "pages"), action: features.blog ? "Open the blog" : "Add a blog" },
    { title: "Shop", help: "Products, checkout and orders.", on: features.store, href: features.store ? hubTabHref(siteId, "products") : hubTabHref(siteId, "pages"), action: features.store ? "Open the shop" : "Start selling" },
    ...(features.store ? [{ title: "Shop settings", help: "Payments, delivery, discounts and emails to customers.", href: `/dashboard/commerce/${siteId}/settings`, action: "Open shop settings" }] : []),
    { title: "Your own lists", help: "Videos, stories, events, team members and more.", count: data.contentTypeCount, countLabel: data.contentTypeCount === 1 ? "list" : "lists", href: sec("lists"), action: "Manage lists" },
    { title: "Pages", help: "Every page on the site.", count: data.pageCount, countLabel: data.pageCount === 1 ? "page" : "pages", href: hubTabHref(siteId, "pages"), action: "Open pages" },
    { title: "Form messages", help: "What visitors have sent you.", count: data.submissionCount, countLabel: data.submissionCount === 1 ? "message" : "messages", href: sec("forms"), action: "Read messages" },
    { title: "Old links", help: "Send old addresses to new pages.", href: sec("redirects"), action: "Manage old links" },
  ];
  return (
    <Card>
      <div>
        {rows.map((r) => (
          <div key={r.title} className="plx-adv__row">
            <div className="plx-adv__grow"><b>{r.title}</b><span>{r.help}</span></div>
            {r.on !== undefined ? <Badge tone={r.on ? "success" : "neutral"}>{r.on ? "On" : "Off"}</Badge> : r.count !== undefined ? <Badge tone="neutral">{r.count.toLocaleString()} {r.countLabel}</Badge> : null}
            <ButtonLink href={r.href} variant="secondary">{r.action}</ButtonLink>
          </div>
        ))}
      </div>
    </Card>
  );
}
