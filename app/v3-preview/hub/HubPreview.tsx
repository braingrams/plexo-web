"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { RouteLoading, type RouteLoadingShape } from "@/app/dashboard/_v3/shell/RouteLoading";
import { startNavProgress } from "@/app/dashboard/_v3/shell/NavProgress";
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
import { ShopLayout } from "@/app/dashboard/_v3/hub/shop/ShopNav";
import { MoneyPanel } from "@/app/dashboard/_v3/hub/shop/MoneyPanel";
import { BookingPanel } from "@/app/dashboard/_v3/hub/shop/BookingPanel";
import { DonationsPanel } from "@/app/dashboard/_v3/hub/shop/DonationsPanel";
import { CustomersPanel } from "@/app/dashboard/_v3/hub/shop/CustomersPanel";
import { GeneralPanel } from "@/app/dashboard/_v3/hub/shop/GeneralPanel";
import { PaymentsPanel } from "@/app/dashboard/_v3/hub/shop/PaymentsPanel";
import { CheckoutPanel } from "@/app/dashboard/_v3/hub/shop/CheckoutPanel";
import { EmailsPanel } from "@/app/dashboard/_v3/hub/shop/EmailsPanel";
import { DeliveryPanel, DiscountsPanel } from "@/app/dashboard/_v3/hub/ProductTools";
import { TabBar } from "@/app/dashboard/_v3/hub/HubFrame";
import { parseSettingsPart, resolveShopSection, shopSections, shopNavGroups, currentShopNavKey } from "@/lib/dashboardV3/shopSections";
import { LayoutModeProvider } from "@/app/dashboard/layout-mode-context";
import { AdvancedArea } from "@/app/dashboard/_v3/hub/advanced/AdvancedArea";
import { advancedKind, advancedSections, resolveAdvancedSection } from "@/lib/dashboardV3/hubAdvanced";
import { hubKindLabel, hubTabs, NO_FEATURES, resolveHubTab, type HubFeatures } from "@/lib/dashboardV3/hubTabs";
import { parseExperience } from "@/lib/dashboardV3/nav";
import { WP_HISTORY, WP_RERUN_PREVIEW } from "../_mock/wp";
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
const swatch = (c: string, n: number) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><rect width="240" height="240" fill="${c}"/><circle cx="120" cy="105" r="${40 + (n % 4) * 8}" fill="rgba(255,255,255,.55)"/><rect x="50" y="165" width="140" height="14" rx="7" fill="rgba(0,0,0,.18)"/></svg>`)}`;
const COLORS = ["#b8f34a", "#f4b942", "#e4572e", "#76b041", "#3d9cd9", "#a06cd5"];
const MORE = ["Suya spice", "Ginger shot", "Plantain chips", "Palm oil (1L)", "Egusi seeds", "Scotch bonnet jar", "Cooking apron", "Spice gift box", "Hot sauce trio", "Chin chin tin", "Zobo mix"];
for (let i = 0; i < PRODUCTS.length; i++) PRODUCTS[i] = { ...PRODUCTS[i], imageUrl: swatch(COLORS[i % 6], i), category: i === 0 || i === 3 ? "Spices" : i === 1 ? "Classes" : i === 2 ? "Downloads" : null };
MORE.forEach((name, i) => PRODUCTS.push({ id: `m${i}`, name, description: null, kind: "PHYSICAL", priceMinor: 200000 + i * 35000, imageUrl: swatch(COLORS[(i + 2) % 6], i + 4), active: true, stockQuantity: i % 5 === 0 ? 0 : 8 + i, category: i % 3 === 0 ? "Spices" : i % 3 === 1 ? "Snacks" : null }));


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
    if (/draft-preview/.test(url)) return real(input, init); // the screenshot harness answers these with a made-up page
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
    // ?posts=60 makes a long blog (pagination); ?credits=0 an empty SOL balance.
    if (/\/api\/blog\/[^/]+\/posts/.test(url) && (init?.method ?? "GET") === "GET") {
      const total = Number(q.get("posts") ?? 2);
      const titles = ["Five spices every kitchen needs", "Our new menu", "How to season a clay pot", "Market day in Accra", "Why we blend by hand", "A gentle guide to scotch bonnet", "Class recap: stews and sauces", "Three ways to use suya spice"];
      return json({ posts: Array.from({ length: total }, (_, i) => ({ id: `x${i}`, title: i < titles.length ? titles[i] : `${titles[i % titles.length]} (part ${Math.floor(i / titles.length) + 1})`, status: i === 1 ? "DRAFT" : i === 4 ? "SCHEDULED" : "PUBLISHED", publishedAt: i === 1 ? null : new Date(Date.now() - i * 86400000 * 3).toISOString(), updatedAt: now, viewCount: Math.max(0, 240 - i * 13) })) });
    }
    if (/\/api\/v1\/wp-migration\/history/.test(url)) return json({ sites: WP_HISTORY.sites.slice(0, 1) });
    if (/\/api\/v1\/wp-migration\/[^/]+\/[^/]+\/rerun/.test(url)) return json(WP_RERUN_PREVIEW);
    if (/\/api\/v1\/profile/.test(url)) return json({ user: { totalCredits: Number(q.get("credits") ?? 180), monthlyCredits: 200 } });
    if (/\/api\/v1\/ai\/estimate/.test(url)) { const c = Number(q.get("credits") ?? 180); return json({ paidBy: "plexo", enough: c > 0, estimatedCredits: 12, balance: c }); }
    if (/\/api\/billing\/topup-packs/.test(url)) return json({ packs: [{ pack: "SMALL", credits: 500, price: "$5" }, { pack: "MEDIUM", credits: 1200, price: "$10" }, { pack: "LARGE", credits: 3000, price: "$20" }] });
    if (/\/lms\/funnels\/[^/]+\/pages$/.test(url)) return json({ pages: [{ id: "l1", title: "Welcome", kind: "WELCOME" }, { id: "l2", title: "Lesson 1: Knives and safety", kind: "VIDEO" }, { id: "l3", title: "Lesson 2: Stocks", kind: "DOCUMENT" }] });
    if (/\/lms\/funnels\/[^/]+\/enrollments$/.test(url)) return json({ enrollments: [{ email: "tolu@example.com", name: "Tolu B.", status: "ACTIVE", paymentStatus: "PAID", completedPageCount: 2, enrolledAt: now }] });
    if (/\/api\/v1\/templates\/[^/]+\/page-seo/.test(url)) {
      if ((init?.method ?? "GET") === "PUT") return json({ success: true });
      return json({ pages: [
        { id: "p1", name: "Home", path: "/", isRaw: false, isRoot: true, title: "Ama's Kitchen | Spices and cooking classes", description: "Spices and cooking classes from Accra.", image: "" },
        { id: "p2", name: "About us", path: "/about", isRaw: false, isRoot: false, title: "", description: "", image: "" },
        { id: "p3", name: "Contact", path: "/contact", isRaw: false, isRoot: false, title: "Contact Ama", description: "", image: "" },
        { id: "p4", name: "Shop", path: "/shop", isRaw: false, isRoot: false, title: "Shop", description: "Spices, sauces and classes.", image: "" },
        { id: "p7", name: "Press kit", path: "/press", isRaw: true, isRoot: false, title: "", description: "", image: "" },
      ], truncated: false });
    }
    if (/\/api\/templates\/[^/]+\/pages$/.test(url)) return json({ rootId: "p1", currentId: "p1", pages: [{ id: "p1", name: "Home", parentId: null, slug: null, sourceType: "BUILDER" }, { id: "p2", name: "About us", parentId: "p1", slug: "about", sourceType: "BUILDER" }, { id: "p7", name: "Press kit", parentId: "p1", slug: "press", sourceType: "RAW_UPLOAD" }] });
    if (/\/api\/templates\/[^/]+\/revisions/.test(url)) return json({ revisions: [{ id: "r3", createdAt: now, authorName: "Ama Mensah", isActive: true }, { id: "r2", createdAt: "2026-11-12T09:20:00Z", authorName: "Ama Mensah", isActive: false }, { id: "r1", createdAt: "2026-11-02T16:05:00Z", authorName: "Kofi Boateng", isActive: false }] });
    if (/\/api\/templates\/p7\?/.test(url)) return json({ page: { id: "p7", name: "Press kit", compiledHtml: "<h1>Press</h1>", previewHtml: "" } });
    if (/\/api\/templates\/[^/?]+\?include=design/.test(url)) return json({ page: { id: "p1", name: "Home", compiledHtml: "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n  <meta charset=\"utf-8\">\n  <title>Ama's Kitchen</title>\n  <meta name=\"description\" content=\"Spices and cooking classes from Accra.\">\n</head>\n<body>\n  <section class=\"hero\">\n    <h1>Spices that taste like home</h1>\n    <a class=\"btn\" href=\"/shop\">Shop now</a>\n  </section>\n</body>\n</html>", previewHtml: "", designJson: { format: "plexo-v2@1", meta: { htmlTitle: "Ama's Kitchen" }, pages: [{ id: "home", sections: [{ type: "hero" }] }] }, sourceType: "BUILDER" } });
    if (/\/api\/v1\/templates\/[^/]+\/files(\?|$)/.test(url)) return json({ files: [{ path: "index.html", size: 420, editable: true, content: "<!DOCTYPE html>\n<html>\n<head><title>Press kit</title><link rel=\"stylesheet\" href=\"style.css\"></head>\n<body>\n  <h1>Press kit</h1>\n</body>\n</html>" }, { path: "style.css", size: 60, editable: true, content: "body { font-family: sans-serif; margin: 2rem; }\nh1 { color: #1f6f4a; }" }, { path: "logo.png", size: 4000, editable: false }] });
    if (/\/api\/v1\/templates\/[^/]+\/form-settings/.test(url)) return json({ forms: [{ formName: "Contact", maildripGroupId: null, maildripGroupTitle: null, webhookUrl: null, redirectUrl: null, source: null, note: null, lastDeliveredAt: null, lastDeliveryError: null }], maildrip: { connected: false, groups: [], error: null } });
    if (/\/api\/v1\/templates\/[^/]+\/form-submissions/.test(url)) return json({ submissions: [{ id: "f1", formName: "Contact", fields: { name: "Kofi Mensah", email: "kofi@example.com", message: "Do you ship to Kumasi?" }, createdAt: now, likelySpam: false }], total: 1, page: 1, pageSize: 25 });
    if (/\/api\/v1\/templates\/[^/]+\/script-access/.test(url)) return json({ status: "NONE", requestId: null, remainingSeconds: null, rejectionReason: null, reason: null });
    if (/\/api\/v1\/templates\/[^/]+\/deploy/.test(url)) return json({ deployed: false });
    if (/\/api\/v1\/apps\/[^/]+$/.test(url) && (init?.method ?? "GET") === "GET") return json({ id: "s1", name: "Ama's Kitchen", previewUrl: "https://preview-ama.plexoapps.com", liveUrl: "https://amaskitchen.plexopages.com", published: true, domains: [{ domain: "amaskitchen.plexopages.com", type: "SUBDOMAIN", verified: true }], headVersionId: "v3", latestBuild: { id: "b3", versionId: "v3", finishedAt: now, summary: "Added the order page" }, liveBuild: { id: "b2", versionId: "v2", finishedAt: now }, databases: [{ env: "dev", status: "READY", lastMigrationAt: now }, { env: "live", status: "READY", lastMigrationAt: now }] });
    if (/\/api\/v1\/apps\/[^/]+\/settings/.test(url)) return json({ auth: { password: true, magicLink: true, google: false, googleClientId: null, hasGoogleClientSecret: false, usesPlexoGoogleClient: true, requireEmailConfirmation: false, allowSignups: true, emailFromName: "Ama's Kitchen", extraRedirectOrigins: [] }, buckets: { avatars: { access: "public" }, orders: { access: "private", maxBytes: 5242880 } }, requestsPerMinute: 120, seo: { title: "Ama's Kitchen orders", description: "Order spices and book classes.", googleVerification: "" } });
    if (/\/api\/v1\/apps\/[^/]+\/files\?paths=/.test(url)) return json({ files: [{ path: "src/App.tsx", content: "export default function App() {\n  return <main className=\"p-8\"><h1>Ama's Kitchen</h1></main>;\n}\n", size: 90, contentType: "text/typescript" }], missing: [] });
    if (/\/api\/v1\/apps\/[^/]+\/files/.test(url)) return json({ files: [{ path: "package.json", size: 400, contentType: "application/json", sha: "a" }, { path: "src/App.tsx", size: 90, contentType: "text/typescript", sha: "b" }, { path: "src/main.tsx", size: 120, contentType: "text/typescript", sha: "c" }, { path: "src/styles.css", size: 300, contentType: "text/css", sha: "d" }] });
    if (/\/api\/v1\/apps\/[^/]+\/versions/.test(url)) return json({ versions: [{ id: "v3", message: "Added the order page", source: "SOL", authorName: "Ama", fileCount: 12, commitSha: null, createdAt: now, isLive: false }, { id: "v2", message: "First version online", source: "SOL", authorName: "Ama", fileCount: 10, commitSha: null, createdAt: "2026-11-10T10:00:00Z", isLive: true }] });
    if (/\/api\/v1\/apps\/[^/]+\/builds/.test(url)) return json({ builds: [{ id: "b3", versionId: "v3", mode: "preview", status: "SUCCEEDED", summary: "Added the order page", createdAt: now, finishedAt: now, durationMs: 4200 }] });
    if (/\/api\/v1\/apps\/[^/]+\/users/.test(url)) return json({ users: [{ id: "u1", email: "kofi@example.com", role: "user", disabled: false, createdAt: now, lastSignInAt: now }, { id: "u2", email: "ada@example.com", role: "admin", disabled: false, createdAt: now, lastSignInAt: null }], total: 2 });
    if (/\/api\/v1\/apps\/[^/]+\/secrets/.test(url)) return json({ secrets: [{ name: "STRIPE_KEY", scope: "live", hint: "x9f2", updatedAt: now }] });
    if (/\/api\/v1\/apps\/[^/]+\/functions/.test(url)) return json({ functions: [{ name: "send-receipt", env: "dev", status: "READY", updatedAt: now, lastInvokedAt: now }, { name: "send-receipt", env: "live", status: "READY", updatedAt: now, lastInvokedAt: now }] });
    if (/\/api\/v1\/apps\/[^/]+\/github/.test(url)) return json({ configured: true, linked: false, installations: [{ id: 1, account: "ama" }], installUrl: "#", repos: [] });
    if (/site-meta/.test(url)) return json({ htmlTitle: "Ama's Kitchen", favicon: "", metaDescription: "Spices and cooking classes from Accra.", ogImageUrl: "" });
    if (/\/commerce\/[^/]+\/availability\?/.test(url)) return json({ rules: [1, 2, 3, 4, 5].map((d) => ({ id: `r${d}`, dayOfWeek: d, startMinute: 540, endMinute: 1020, timezone: "Africa/Lagos" })), exceptions: [{ id: "e1", date: "2026-12-25T00:00:00Z", closed: true }] });
    if (/\/commerce\/[^/]+\/wallet(\?|$)/.test(url)) return json({ wallet: { balanceCents: 18500000 }, ledger: [], ledgerTotal: 0, page: 1, pageSize: 25 });
    if (/\/commerce\/[^/]+\/customers/.test(url)) return json({ page: 1, total: 3, customers: [{ email: "kofi@example.com", name: "Kofi Mensah", phone: "+233 24 555 0101", customerSince: "2026-08-02T00:00:00Z", lastOrderAt: now, orderCount: 4, totalSpentMinor: 3600000, currency: "NGN" }, { email: "ada@example.com", name: null, phone: null, customerSince: "2026-10-11T00:00:00Z", lastOrderAt: now, orderCount: 1, totalSpentMinor: 1500000, currency: "NGN" }, { email: "zane@example.com", name: "Zane A.", phone: "0803 555 0199", customerSince: "2026-09-21T00:00:00Z", lastOrderAt: now, orderCount: 2, totalSpentMinor: 750000, currency: "NGN" }] });
    if (/\/commerce\/stripe-access/.test(url)) return json({ status: "NONE" });
    if (/\/maildrip\/[^/]+\/groups/.test(url)) return json({ groups: [{ id: "g1", title: "Customers", description: null, totalContacts: 128 }, { id: "g2", title: "Newsletter", description: null, totalContacts: 342 }] });
    if (/\/commerce\/[^/]+\/product-detail-layout/.test(url)) return json({ candidates: [] });
    if (url.startsWith("/api/") && (init?.method ?? "GET") === "GET") return json({});
    return real(input, init);
  };
}

export function HubPreview() {
  const q = useSearchParams();
  useState(installFake);
  const kind = q.get("kind") ?? "store";
  const exp = parseExperience(q.get("exp")) ?? "beginner";
  const features: HubFeatures = { ...NO_FEATURES, store: kind === "store", blog: kind === "blog", course: kind === "course", app: kind === "app", migrated: kind === "moved", deployed: kind === "server" ? "server" : kind === "static" ? "static" : null };
  const site: HubSite = { id: "s1", name: kind === "course" ? "Cooking with Ama" : "Ama's Kitchen", kind: hubKindLabel(features), status: kind === "blog" ? "draft" : "live", address: kind === "blog" ? null : "amaskitchen.plexopages.com", features, sourceType: kind === "app" ? "REACT_PROJECT" : "BUILDER", designFormat: "v2", domains: [], currency: "NGN", deployed: features.deployed ?? null, app: features.deployed ? { kind: features.deployed, isLive: true, framework: "Next.js" } : null, editHref: "#" };
  const ldg = q.get("ldg") as RouteLoadingShape | null;
  const navp = q.get("navp");
  // Preview only: see the loading skeletons (?ldg=hub|settings|list|cards) and the top bar (?navp=1).
  useEffect(() => { if (!navp) return; const t = setTimeout(startNavProgress, 800); return () => clearTimeout(t); }, [navp]);
  if (ldg) return <RouteLoading shape={ldg} />;
  const tab = resolveHubTab(q.get("tab"), features, exp);
  const pages = kind === "store" ? PAGES : PAGES.slice(0, 3);
  if (q.get("list")) {
    return (
      <SitesList
        experience={exp}
        sites={[
          { id: "s1", name: "Ama's Kitchen", kind: "Online store", status: "live", address: "amaskitchen.plexopages.com", visits7d: 214, editHref: "#", app: false },
          { id: "s2", name: "Cooking with Ama", kind: "Course", status: "live", address: "learn.amaskitchen.com", visits7d: 58, editHref: "#", app: false },
          { id: "s3", name: "Kitchen notes", kind: "Blog", status: "draft", address: null, visits7d: 0, editHref: "#", app: false },
        ]}
      />
    );
  }
  let content: React.ReactNode;
  if (tab === "products") content = <ProductsTab siteId="s1" products={PRODUCTS} currency="NGN" experience={exp} startNew={q.get("new") === "service" ? "service" : q.get("new") === "product" ? "product" : undefined} />;
  else if (tab === "orders") content = <OrdersTab siteId="s1" currency="NGN" />;
  else if (tab === "shop") content = <ShopPreview section={q.get("section")} part={q.get("part")} />;
  else if (tab === "blog") content = <BlogTab siteId="s1" experience={exp} />;
  else if (tab === "course") content = <CourseTab siteId="s1" />;
  else if (tab === "app" && site.app) content = <AppTab siteId="s1" siteName={site.name} info={site.app} />;
  else if (tab === "brand") content = <BrandTab siteId="s1" siteName={site.name} experience={exp} brand={{ colors: ["#B8F34A", "#517A12"], noLogo: true }} />;
  else if (tab === "address") content = <AddressTab siteId="s1" siteName={site.name} experience={exp} />;
  else if (tab === "visits") content = <VisitsTab siteId="s1" live={false} visits={{ total: 412, days: Array.from({ length: 14 }, (_, i) => ({ label: `Nov ${i + 3}`, views: [12, 30, 22, 41, 18, 9, 33, 52, 38, 27, 45, 61, 19, 5][i] })) }} />;
  else if (tab === "advanced") {
    const sections = advancedSections({ kind: advancedKind(features), experience: exp, ssrEnabled: true, server: kind === "server", ownCode: false });
    const section = resolveAdvancedSection(q.get("section"), sections);
    const data = {
      redirects: [{ fromPath: "/old-menu", toPath: "/shop", createdAt: now, permanent: true }, { fromPath: "/classes-2023", toPath: "/classes", createdAt: now, permanent: false }],
      contentTypes: [{ id: "t1", name: "Events", slug: "events", fields: [{ id: "f1", name: "Title", key: "title", type: "text" as const, required: true }], entryCount: 3, createdAt: now }],
      layout: { enabled: true, header: { templateId: "h1", updatedAt: now }, footer: null },
      features: { layoutEnabled: true, pageCount: pages.length, submissionCount: 12, contentTypeCount: 1 },
      deploy: { app: kind === "static" ? { framework: "spa", spaMode: true, updatedAt: now, hostingTier: "LAMBDA", allowedTiers: ["LAMBDA"], ssr: false } : null, liveDomain: "amaskitchen.plexopages.com" },
    };
    // The real dashboard shell already provides this (some old screens read it).
    content = section ? <LayoutModeProvider initialMode="CLASSIC"><AdvancedArea site={site} sections={sections} current={section} data={data} /></LayoutModeProvider> : null;
  }
  else if (tab === "settings") content = <SettingsTab site={site} features={features} experience={exp} />;
  else
    content = (
      <>
        <PagesTab site={site} pages={pages} experience={exp} plan={q.get("plan") === "free" ? "FREE" : "STARTER"} />
        <AddMoreCards siteId="s1" siteName={site.name} features={features} />
      </>
    );
  return (
    <HubFrame site={site} tabs={hubTabs(features, exp)} current={tab} experience={exp}>
      {content}
    </HubFrame>
  );
}


const money = { showWallet: true, commerceEnabled: true, balanceCents: 18500000, currency: "NGN", pooled: false, ledgerTotal: 3, ledgerPage: 1, ledgerPageSize: 25,
  ledger: [
    { id: "l1", type: "SALE_CREDIT" as const, grossAmountCents: 900000, feeCents: 13500, netAmountCents: 886500, balanceAfterCents: 18500000, description: "Order #1042", createdAt: now },
    { id: "l2", type: "SALE_CREDIT" as const, grossAmountCents: 300000, feeCents: 4500, netAmountCents: 295500, balanceAfterCents: 17613500, description: "Order #1040", createdAt: "2026-11-14T09:00:00Z" },
    { id: "l3", type: "WITHDRAWAL_DEBIT" as const, grossAmountCents: null, feeCents: null, netAmountCents: -5000000, balanceAfterCents: 17318000, description: null, createdAt: "2026-11-09T09:00:00Z" },
  ],
  withdrawals: [
    { id: "w1", amountCents: 4000000, bankName: "GTBank", status: "PENDING" as const, rejectionReason: null, requestedAt: "2026-11-15T08:00:00Z", processedAt: null },
    { id: "w2", amountCents: 5000000, bankName: "GTBank", status: "PROCESSED" as const, rejectionReason: null, requestedAt: "2026-11-09T09:00:00Z", processedAt: "2026-11-11T09:00:00Z" },
  ] };
const donations = { currency: "NGN", enabled: true, paymentsReady: true, monthlyReady: true,
  totals: { raisedMinor: 48500000, gifts: 37, donors: 29, monthlyDonors: 6, monthlyRecurringMinor: 3000000 },
  campaigns: [
    { id: "c1", name: "Feed 100 families", description: null, presetAmounts: [{ amountMinor: 500000 }, { amountMinor: 1000000, label: "Friend" }, { amountMinor: 2500000 }], defaultPresetIndex: 1, allowCustomAmount: true, minAmountMinor: 100000, allowMonthly: true, defaultFrequency: "ONCE", goalAmountMinor: 100000000, raisedMinor: 48500000, donationCount: 37, monthlyDonors: 6, active: true, source: null, paymentIssue: null },
    { id: "c2", name: "School books drive", description: null, presetAmounts: [{ amountMinor: 200000 }], defaultPresetIndex: 0, allowCustomAmount: true, minAmountMinor: 100000, allowMonthly: false, defaultFrequency: "ONCE", goalAmountMinor: null, raisedMinor: 0, donationCount: 0, monthlyDonors: 0, active: false, source: null, paymentIssue: null },
  ],
  monthlyDonors: [{ id: "s1", donorName: "Tolu B.", donorEmail: "tolu@example.com", amountMinor: 500000, currency: "NGN", status: "ACTIVE", chargesCount: 4 }, { id: "s2", donorName: null, donorEmail: "kemi@example.com", amountMinor: 500000, currency: "NGN", status: "PAST_DUE", chargesCount: 2 }],
  recentGifts: [{ id: "g1", donorName: "Kofi Mensah", donorEmail: "kofi@example.com", campaignName: "Feed 100 families", amountMinor: 1000000, currency: "NGN", status: "PAID", monthly: false, createdAt: now }, { id: "g2", donorName: null, donorEmail: "ada@example.com", campaignName: "Feed 100 families", amountMinor: 500000, currency: "NGN", status: "PAID", monthly: true, createdAt: now }] } as never;
const flags = { Paid: true, Processing: true, ReadyForPickup: false, Shipped: true, Completed: true, Refunded: true };

function ShopPreview({ section: sectionParam, part: partParam }: { section: string | null; part: string | null }) {
  const sections = shopSections({ sellsServices: true });
  const section = resolveShopSection(sectionParam, sections);
  const part = parseSettingsPart(partParam);
  const groups = shopNavGroups(sections);
  const key = currentShopNavKey(section, part);
  const info = groups.flatMap((g) => g.items).find((i) => i.key === key)!;
  let body: React.ReactNode;
  if (section === "money") body = <MoneyPanel templateId="s1" initial={money} />;
  else if (section === "bookings") body = <BookingPanel templateId="s1" services={[{ id: "b", name: "Cooking class (2 hours)", durationMinutes: 120 }, { id: "b2", name: "Private tasting", durationMinutes: 60 }]} />;
  else if (section === "donations") body = <DonationsPanel templateId="s1" initial={donations} />;
  else if (section === "customers") body = <CustomersPanel templateId="s1" />;
  else if (section === "discounts") body = <DiscountsPanel siteId="s1" currency="NGN" />;
  else if (section === "delivery") body = <DeliveryPanel siteId="s1" currency="NGN" />;
  else
    body = (
      <>
        {part === "payments" ? <PaymentsPanel templateId="s1" initial={{ paymentProvider: "BYO_PAYSTACK", paystackMode: "TEST", paystackTestPublicKey: "pk_test_8f2a", paystackLivePublicKey: "", paystackTestSecretKeyMasked: "sk_t…c91", paystackLiveSecretKeyMasked: null, stripeMode: "TEST", stripeTestPublishableKey: "", stripeLivePublishableKey: "", stripeTestSecretKeyMasked: null, stripeLiveSecretKeyMasked: null, stripeTestWebhookSecretMasked: null, stripeLiveWebhookSecretMasked: null, bankTransferEnabled: true, bankTransferBankName: "GTBank", bankTransferAccountName: "Ama's Kitchen Ltd", bankTransferAccountNumber: "0123456789", bankTransferInstructions: "Use your order number as the reference." }} />
          : part === "checkout" ? <CheckoutPanel templateId="s1" initial={{ fields: [{ id: "q1", label: "Gift message", type: "textarea", required: false }, { id: "q2", label: "Preferred delivery date", type: "date", required: true, countries: ["NG"] }], deliveryEnabled: true, pickupEnabled: true, pickupLocation: "12 Allen Avenue, Ikeja", pickupInstructions: "Open 9 to 5, Monday to Saturday.", termsText: "", termsUrl: "", shopName: "Ama's Kitchen", contactEmail: "ama@amaskitchen.com" }} />
          : part === "notifications" ? <EmailsPanel templateId="s1" initial={{ shopName: "Ama's Kitchen", flags, mailing: { maildripConnected: true, maildripPaidGroupId: "g1", maildripNewsletterGroupId: "g2", newsletterPopupEnabled: true, notificationEmail: "" } }} />
          : <GeneralPanel templateId="s1" initial={{ siteName: "Ama's Kitchen", enabled: true, currency: "NGN", storefrontSlug: "shop", notificationEmail: "ama@amaskitchen.com", hasOrders: true, productDetailLayout: { templateId: "t2", ready: true }, themeAccentColor: null, themeButtonRadius: null, autoDetectedTheme: null }} />}
      </>
    );
  return (
    <>
      <ShopLayout siteId="s1" groups={groups} current={key}>
        <TabBar title={info.label} sub={info.help} />
        <div>{body}</div>
      </ShopLayout>
    </>
  );
}
