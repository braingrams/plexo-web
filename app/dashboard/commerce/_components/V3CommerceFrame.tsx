"use client";

import "./cmx.css";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { Badge, ButtonLink, TabLinks } from "../../_v3/ui";
import { commerceNavItems, currentCommerceHref } from "@/lib/dashboardV3/commerceNav";
import { siteHubHref } from "@/lib/dashboardV3/hubPaths";
import type { CommerceSiteInfo } from "./CommerceSiteHeader";

/** The top of every shop page on the new dashboard: which shop, whether it's on, one row of tabs. Full width. */
export function V3CommerceFrame({ currentSite, otherSites, children }: { currentSite: CommerceSiteInfo; otherSites: CommerceSiteInfo[]; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const items = commerceNavItems(currentSite.id);
  const shopUrl = currentSite.domain ? `https://${currentSite.domain}${currentSite.storefrontSlug ? `/${currentSite.storefrontSlug.replace(/^\//, "")}` : ""}` : null;
  const switchTo = (id: string) => router.push(pathname.replace(`/dashboard/commerce/${currentSite.id}`, `/dashboard/commerce/${id}`));
  return (
    <div className="plx-page plx-shop" data-tour="shop-main">
      <div>
        <Link href={siteHubHref(currentSite.id, "products")} className="plx-hub__back">
          <ArrowLeft size={18} aria-hidden /> Back to {currentSite.name}
        </Link>
      </div>
      <header className="plx-shop__head">
        <div className="plx-shop__id">
          <div className="plx-shop__title">
            <h1 className="plx-h1">Your shop</h1>
            <Badge tone={currentSite.enabled ? "success" : "warning"} dot>
              {currentSite.enabled ? "Shop is on" : "Shop is off"}
            </Badge>
          </div>
          <div className="plx-shop__switch">
            <span>{currentSite.name}</span>
            {otherSites.length > 0 ? (
              <label className="plx-shop__switch">
                <span className="plx-sr-only">Switch shop</span>
                <select className="plx-shop__select" value={currentSite.id} onChange={(e) => switchTo(e.target.value)} aria-label="Switch shop">
                  <option value={currentSite.id}>{currentSite.name}</option>
                  {otherSites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
        </div>
        {shopUrl ? (
          <ButtonLink href={shopUrl} target="_blank" rel="noreferrer" variant="secondary" rightIcon={<ExternalLink size={16} aria-hidden />}>
            Visit shop
          </ButtonLink>
        ) : null}
      </header>
      <div className="plx-shop__tabs" data-tour="shop-tabs">
        <TabLinks label="Your shop" current={currentCommerceHref(items, pathname)} items={items} />
      </div>
      <div className="plx-shop__body">{children}</div>
    </div>
  );
}
