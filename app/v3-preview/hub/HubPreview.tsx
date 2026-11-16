"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { HubFrame } from "@/app/dashboard/_v3/hub/HubFrame";
import { PagesTab } from "@/app/dashboard/_v3/hub/PagesTab";
import { ProductsTab } from "@/app/dashboard/_v3/hub/ProductsTab";
import { OrdersTab } from "@/app/dashboard/_v3/hub/OrdersTab";
import { AddressTab } from "@/app/dashboard/_v3/hub/AddressTab";
import { BlogTab } from "@/app/dashboard/_v3/hub/BlogTab";
import { CourseTab } from "@/app/dashboard/_v3/hub/CourseTab";
import { AppTab } from "@/app/dashboard/_v3/hub/AppTab";
import { BrandTab } from "@/app/dashboard/_v3/hub/BrandTab";
import { VisitsTab } from "@/app/dashboard/_v3/hub/VisitsTab";
import { SettingsTab } from "@/app/dashboard/_v3/hub/SettingsTab";
import { AddMoreCards } from "@/app/dashboard/_v3/hub/AddMore";
import { SitesList } from "@/app/dashboard/_v3/hub/SitesList";
import { hubKindLabel, hubTabs, NO_FEATURES, resolveHubTab, type HubFeatures } from "@/lib/dashboardV3/hubTabs";
import { parseExperience } from "@/lib/dashboardV3/nav";
import type { HubPage, HubProduct, HubSite } from "@/lib/dashboardV3/hubData";

const now = "2026-11-15T10:00:00Z";
const PAGES: HubPage[] = [
  { id: "p1", parentId: null, order: 0, name: "Home", slug: null, path: "/", isRoot: true, isPublished: true, archivedByPlan: false, sourceType: "BUILDER", updatedAt: now },
  { id: "p2", parentId: "p1", order: 0, name: "About us", slug: "about", path: "/about", isRoot: false, isPublished: true, archivedByPlan: false, sourceType: "BUILDER", updatedAt: now },
  { id: "p3", parentId: "p1", order: 1, name: "Contact", slug: "contact", path: "/contact", isRoot: false, isPublished: false, archivedByPlan: false, sourceType: "BUILDER", updatedAt: now },
  { id: "p4", parentId: "p1", order: 2, name: "Shop", slug: "shop", path: "/shop", isRoot: false, isPublished: true, archivedByPlan: false, sourceType: "BUILDER", updatedAt: now },
  { id: "p5", parentId: "p4", order: 0, name: "Checkout", slug: "checkout", path: "/shop/checkout", isRoot: false, isPublished: true, archivedByPlan: false, sourceType: "BUILDER", updatedAt: now },
  { id: "p6", parentId: "p1", order: 3, name: "Order Confirmation", slug: "order-confirmation", path: "/order-confirmation", isRoot: false, isPublished: true, archivedByPlan: false, sourceType: "BUILDER", updatedAt: now },
];
const PRODUCTS: HubProduct[] = [
  { id: "a", name: "Jollof spice mix", description: "Our house blend", kind: "PHYSICAL", priceMinor: 450000, imageUrl: null, active: true, stockQuantity: 24, category: null },
  { id: "b", name: "Cooking class (2 hours)", description: null, kind: "SERVICE", priceMinor: 1500000, imageUrl: null, active: true, stockQuantity: null, category: null },
  { id: "c", name: "Recipe ebook", description: null, kind: "DIGITAL", priceMinor: 250000, imageUrl: null, active: false, stockQuantity: null, category: null },
  { id: "d", name: "Pepper sauce", description: null, kind: "PHYSICAL", priceMinor: 300000, imageUrl: null, active: true, stockQuantity: 0, category: null },
];

const BRAND_CSS = ":root{--color-action-primary-bg:#1f6f4a;--color-brand-primary-500:#b8f34a;--color-bg-canvas:#fbf7ef;--color-text-primary:#1d2a22;--font-family-heading:'Fraunces', serif;--font-family-body:'Inter', sans-serif;}";
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
function installFake() {
  if (typeof window === "undefined") return;
  const w = window as unknown as { __hubFake?: boolean };
  if (w.__hubFake) return;
  w.__hubFake = true;
  const real = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (/\/snapshot/.test(url)) return json({}, 404);
    const q = new URLSearchParams(window.location.search);
    if (/\/api\/v1\/strata\/session/.test(url)) return json({ available: true, connected: true });
    if (/\/api\/v1\/strata\/projects/.test(url)) return json({ projects: [{ id: "b1", name: "Ama's Kitchen brand" }] });
    if (/\/api\/public\/brand\//.test(url)) return Promise.resolve(new Response(BRAND_CSS, { headers: { "Content-Type": "text/css" } }));
    if (/\/api\/v1\/sites\/[^/]+\/brand/.test(url))
      return q.get("brand") === "off"
        ? json({ linked: false, projectId: null, projectName: null, autoSync: false, status: "off", updatedAt: null, lastResult: null, lastResultKind: null, lastSource: null, useOnSite: false, canUseOnSite: false })
        : json({ linked: true, projectId: "b1", projectName: "Ama's Kitchen brand", autoSync: true, status: "active", updatedAt: new Date(Date.now() - 120000).toISOString(), lastResult: null, lastResultKind: "updated", lastSource: "webhook", useOnSite: true, canUseOnSite: true });
    if (/\/api\/v1\/sites\/[^/]+\/menu/.test(url)) return json({ available: true, hrefs: ["/", "/about", "/shop"] });
    if (/\/ssr-git(\?|$)/.test(url)) return json({ linked: true, repo: "ama/kitchen-app", branch: "main", status: "OK", publishOnPush: true, activeBuildId: null });
    if (/\/ssr-github/.test(url)) return json({ configured: true, link: { installationId: 1, repo: "ama/kitchen-app", branch: "main", status: "OK" }, installations: [{ id: 1, account: "ama" }], installUrl: "#" });
    if (/\/ssr-always-on/.test(url)) return json({ request: "REQUESTED", status: "OFF", error: null });
    if (/\/ssr-variables/.test(url)) return json({ variables: [{ name: "SITE_NAME", scope: "all", value: "Ama's Kitchen", buildTime: false }, { name: "NEXT_PUBLIC_API", scope: "live", value: "https://api.example.com", buildTime: true }] });
    if (/\/ssr-secrets/.test(url)) return json({ secrets: [{ name: "STRIPE_KEY", scope: "live", hint: "x9f2" }], needsRebuild: false, hasSource: true });
    if (/\/commerce\/[^/]+\/discounts/.test(url)) return json({ discounts: [{ id: "d1", code: "WELCOME10", type: "PERCENT", value: 10, active: true, expiresAt: null, usageLimit: 100, usedCount: 14 }, { id: "d2", code: "FREESHIP", type: "FIXED", value: 150000, active: false, expiresAt: "2026-12-31", usageLimit: null, usedCount: 3 }] });
    if (/\/commerce\/[^/]+\/delivery-methods/.test(url)) return json({ methods: [{ id: "m1", name: "Lagos delivery", type: "COURIER", feeMinor: 150000, description: null, estimatedTimeLabel: "1 to 2 days", countries: [], states: ["Lagos"], status: "ACTIVE" }, { id: "m2", name: "Pick up at the kitchen", type: "PICKUP", feeMinor: 0, description: "12 Palm Rd, Accra", estimatedTimeLabel: null, countries: [], states: [], status: "ACTIVE" }] });
    if (/\/commerce\/[^/]+\/settings/.test(url)) return json({ settings: { deliveryEnabled: true, pickupEnabled: true } });
    if (/\/commerce\/[^/]+\/products\/[^/]+$/.test(url) && (init?.method ?? "GET") === "GET") return json({ product: { id: "a", durationMinutes: 60, category: { name: "Spices" }, compareAtPriceMinor: 550000, sku: "JSM-01", options: [{ name: "Size", values: ["Small", "Large"] }], variants: [{ id: "v1", options: { Size: "Small" }, priceMinor: 450000, stockQuantity: 12, active: true }, { id: "v2", options: { Size: "Large" }, priceMinor: 750000, stockQuantity: 0, active: true }] } });
    if (/\/commerce\/[^/]+\/orders\?/.test(url))
      return json({
        total: 3,
        orders: [
          { id: "o1", orderNumber: 1042, status: "PAID", fulfillmentStatus: "UNFULFILLED", amountMinor: 900000, currency: "NGN", customerEmail: "kofi@example.com", customerName: "Kofi Mensah", createdAt: now, items: [{ nameSnapshot: "Jollof spice mix", quantity: 2, unitPriceMinor: 450000 }] },
          { id: "o2", orderNumber: 1041, status: "PENDING", fulfillmentStatus: "UNFULFILLED", paymentMethod: "BANK_TRANSFER", amountMinor: 1500000, currency: "NGN", customerEmail: "ada@example.com", createdAt: now, items: [{ nameSnapshot: "Cooking class (2 hours)", quantity: 1, unitPriceMinor: 1500000 }] },
          { id: "o3", orderNumber: 1040, status: "PAID", fulfillmentStatus: "SHIPPED", amountMinor: 300000, currency: "NGN", customerEmail: "zane@example.com", customerName: "Zane A.", createdAt: now, items: [{ nameSnapshot: "Pepper sauce", quantity: 1, unitPriceMinor: 300000 }] },
        ],
      });
    if (/\/api\/v1\/domains\?/.test(url)) return json({ domains: [{ id: "d1", domain: "amaskitchen.plexopages.com", type: "SUBDOMAIN", active: true }, { id: "d2", domain: "www.amaskitchen.com", type: "CUSTOM", active: true, certificateStatus: "PENDING_VALIDATION", certificateValidationName: "_a1b2c3.www.amaskitchen.com.", certificateValidationValue: "_d4e5f6.acm-validations.aws." }], baseDomain: "plexopages.com", routingEndpoint: "d111abcdef8.cloudfront.net", limit: 3, count: 1 });
    if (/\/api\/blog\/[^/]+\/posts/.test(url)) return json({ posts: [{ id: "x1", title: "Five spices every kitchen needs", status: "PUBLISHED", publishedAt: now, updatedAt: now, viewCount: 128 }, { id: "x2", title: "Our new menu", status: "DRAFT", publishedAt: null, updatedAt: now, viewCount: 0 }] });
    if (/\/lms\/funnels\/[^/]+\/pages$/.test(url)) return json({ pages: [{ id: "l1", title: "Welcome", kind: "WELCOME" }, { id: "l2", title: "Lesson 1: Knives and safety", kind: "VIDEO" }, { id: "l3", title: "Lesson 2: Stocks", kind: "DOCUMENT" }] });
    if (/\/lms\/funnels\/[^/]+\/enrollments$/.test(url)) return json({ enrollments: [{ email: "tolu@example.com", name: "Tolu B.", status: "ACTIVE", paymentStatus: "PAID", completedPageCount: 2, enrolledAt: now }] });
    if (/site-meta/.test(url)) return json({ htmlTitle: "Ama's Kitchen", favicon: "", metaDescription: "Spices and cooking classes from Accra.", ogImageUrl: "" });
    if (url.startsWith("/api/") && (init?.method ?? "GET") === "GET") return json({});
    return real(input, init);
  };
}

export function HubPreview() {
  const q = useSearchParams();
  useState(installFake);
  const kind = q.get("kind") ?? "store";
  const exp = parseExperience(q.get("exp")) ?? "beginner";
  const features: HubFeatures = { ...NO_FEATURES, store: kind === "store", blog: kind === "blog", course: kind === "course", app: kind === "app", deployed: kind === "server" ? "server" : kind === "static" ? "static" : null };
  const site: HubSite = { id: "s1", name: kind === "course" ? "Cooking with Ama" : "Ama's Kitchen", kind: hubKindLabel(features), status: kind === "blog" ? "draft" : "live", address: kind === "blog" ? null : "amaskitchen.plexopages.com", features, sourceType: kind === "app" ? "REACT_PROJECT" : "BUILDER", designFormat: "v2", domains: [], currency: "NGN", deployed: features.deployed ?? null, app: features.deployed ? { kind: features.deployed, isLive: true, framework: "Next.js" } : null, editHref: "#" };
  const tab = resolveHubTab(q.get("tab"), features, exp);
  const pages = kind === "store" ? PAGES : PAGES.slice(0, 3);
  if (q.get("list")) {
    return (
      <SitesList
        experience={exp}
        sites={[
          { id: "s1", name: "Ama's Kitchen", kind: "Online store", status: "live", address: "amaskitchen.plexopages.com", visits7d: 214, editHref: "#" },
          { id: "s2", name: "Cooking with Ama", kind: "Course", status: "live", address: "learn.amaskitchen.com", visits7d: 58, editHref: "#" },
          { id: "s3", name: "Kitchen notes", kind: "Blog", status: "draft", address: null, visits7d: 0, editHref: "#" },
        ]}
      />
    );
  }
  let content: React.ReactNode;
  if (tab === "products") content = <ProductsTab siteId="s1" products={PRODUCTS} currency="NGN" experience={exp} startWithService={q.get("new") === "service"} />;
  else if (tab === "orders") content = <OrdersTab siteId="s1" currency="NGN" />;
  else if (tab === "blog") content = <BlogTab siteId="s1" experience={exp} />;
  else if (tab === "course") content = <CourseTab siteId="s1" />;
  else if (tab === "app" && site.app) content = <AppTab siteId="s1" siteName={site.name} info={site.app} />;
  else if (tab === "brand") content = <BrandTab siteId="s1" siteName={site.name} experience={exp} brand={{ colors: ["#b8f34a", "#517a12", "#f5ac05"] }} />;
  else if (tab === "address") content = <AddressTab siteId="s1" siteName={site.name} experience={exp} />;
  else if (tab === "visits") content = <VisitsTab visits={{ total: 412, days: Array.from({ length: 14 }, (_, i) => ({ label: `Nov ${i + 3}`, views: [12, 30, 22, 41, 18, 9, 33, 52, 38, 27, 45, 61, 19, 5][i] })) }} />;
  else if (tab === "settings") content = <SettingsTab site={site} features={features} experience={exp} />;
  else
    content = (
      <>
        <PagesTab site={site} pages={pages} experience={exp} />
        <AddMoreCards siteId="s1" siteName={site.name} features={features} />
      </>
    );
  return (
    <HubFrame site={site} tabs={hubTabs(features, exp)} current={tab} experience={exp}>
      {content}
    </HubFrame>
  );
}
