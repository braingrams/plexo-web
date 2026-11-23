import "server-only";
/**
 * Everything the v3 Home reads for a site: the facts behind the guided steps (lib/dashboardV3/
 * tasks.ts) and the numbers on the live dashboard. Every read is wrapped so a hiccup in one
 * source shows a plain empty state instead of breaking the page.
 */
import { senderOf, type ActivityKind } from "./seeAllLinks";
import { Template } from "@/lib/db/contentEntities";
import { BlogPost, LmsEnrollment, LmsPage } from "@/lib/db/contentEntities";
import { CommerceOrder, CommerceProduct, CommerceSettings, CommerceDonationCampaign } from "@/lib/db/commerceEntities";
import { FormSubmission, PageView } from "@/lib/db/opsEntities";
import { formatMoney } from "@/lib/commerce/formatMoney";
import { bucketVisitsByDay } from "./visitsTrend";
import { readSiteBrand } from "./brandLook";
import { resolveSiteBrand } from "@/lib/brand/resolveSiteBrand";
import { EMPTY_FACTS, isPublished, taskVariantFor, type SiteFacts, type TaskVariant } from "./tasks";
import type { SiteSummary } from "./sites";
import type { SolBuildProfile } from "@/lib/ai/solBuildContext";

const DAY = 86_400_000;
const EDITED_AFTER_MS = 120_000;

async function safe<T>(label: string, run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run();
  } catch (err) {
    console.error(`v3 home: ${label} failed`, err);
    return fallback;
  }
}

export type SiteHomeData = { variant: TaskVariant; facts: SiteFacts; commerceEnabled: boolean };

/** The facts behind one site's guided steps. */
export async function loadSiteFacts(site: SiteSummary, profile: SolBuildProfile | undefined): Promise<SiteHomeData> {
  const id = site.id;
  const [tpl, settings, products, campaigns, posts, lessons, funnel] = await Promise.all([
    safe("site", async () => (await Template.get({ id }).go({ attributes: ["id", "createdAt", "updatedAt", "activeVersionId", "liveBuildId", "sourceType", "brand", "compiledHtml", "draftHtml"] })).data, null),
    safe("store settings", async () => (await CommerceSettings.get({ templateId: id }).go()).data, null),
    safe("products", async () => (await CommerceProduct.query.primary({ templateId: id }).go({ limit: 1, attributes: ["id"] })).data, []),
    safe("campaigns", async () => (await CommerceDonationCampaign.query.primary({ templateId: id }).go({ limit: 1, attributes: ["id"] })).data, []),
    safe("posts", async () => (await BlogPost.query.primary({ templateId: id }).go({ limit: 1, attributes: ["slug"] })).data, []),
    safe("lessons", async () => (await LmsPage.query.primary({ templateId: id }).go({ pages: "all", attributes: ["id", "kind"] })).data, []),
    safe("course", async () => (await import("@/lib/db/contentEntities").then((m) => m.LmsFunnel.get({ templateId: id }).go())).data, null),
  ]);
  // This site's OWN brand only: its linked Strata project or its saved colours and logo, never the account's (resolveSiteBrand with no profile).
  const own = await resolveSiteBrand({ siteId: id }).catch(() => null).then((r) => (r ? { logoUrl: r.logoUrl, noLogo: r.noLogo, colors: r.colours.map((c) => c.value) } : readSiteBrand(tpl?.brand)));
  const hasProducts = products.length > 0;
  const hasDonations = campaigns.length > 0;
  const commerceEnabled = Boolean(settings?.enabled) && (hasProducts || !hasDonations);
  const acceptsDonations = hasDonations || Boolean(settings?.donationsEnabled && !settings?.enabled);
  const variant = taskVariantFor({ kind: site.kind, sells: commerceEnabled, hasDonations: acceptsDonations, productCount: products.length }, profile?.goal);
  const created = tpl?.createdAt ? Date.parse(tpl.createdAt) : NaN;
  const updated = tpl?.updatedAt ? Date.parse(tpl.updatedAt) : NaN;
  const lessonCount = lessons.filter((l) => l.kind !== "WELCOME").length;
  const edited = Number.isFinite(created) && Number.isFinite(updated) && updated - created > EDITED_AFTER_MS;
  const cardsReady =
    settings?.paymentProvider === "PLATFORM_PAYSTACK" ||
    settings?.paymentProvider === "PLATFORM_STRIPE" ||
    (settings?.paymentProvider === "BYO_STRIPE" && !!settings?.stripeLivePublishableKey && !!settings?.stripeLiveSecretKeyEncrypted) ||
    ((!settings?.paymentProvider || settings?.paymentProvider === "BYO_PAYSTACK") && !!settings?.paystackLivePublicKey && !!settings?.paystackLiveSecretKeyEncrypted);
  const bankReady = !!settings?.bankTransferEnabled && !!settings?.bankTransferAccountNumber;
  const ownDesign = tpl?.sourceType === "RAW_UPLOAD";
  const personalizedWithSol = Boolean(
    tpl?.compiledHtml?.includes('data-sol-personalized="true"') ||
    tpl?.draftHtml?.includes('data-sol-personalized="true"')
  );
  const contactProvided = Boolean(tpl?.compiledHtml?.includes('data-sol-contact="true"') || tpl?.draftHtml?.includes('data-sol-contact="true"'));
  const facts: SiteFacts = {
    ...EMPTY_FACTS,
    hasSite: true,
    // This site's OWN brand only (a different site's logo never ticks this one).
    hasLogo: !!own?.logoUrl,
    logoSkipped: own?.noLogo === true,
    hasColors: !!own?.colors?.length,
    edited,
    productCount: products.length,
    paymentsReady: cardsReady || bankReady,
    postCount: posts.length,
    lessonCount,
    priceSet: funnel?.signupMode === "PAID" || lessonCount > 0,
    hasAddress: !!site.address,
    // An uploaded page is served as it was uploaded, so being on its address is what "online" means for it.
    ownDesign,
    published: isPublished(tpl) || (ownDesign && !!site.address),
    signInOn: edited,
    personalizedWithSol,
    contactProvided,
  };
  return { variant, facts, commerceEnabled };
}

export type OrderRow = { id: string; who: string; amount: string; when: string; paid: boolean };
export type Stat = { id: string; label: string; value: string; hint?: string };
export type SiteStats = {
  stats: Stat[];
  /** Latest orders or sign-ups, newest first. Empty = show the friendly "nothing yet" state. */
  activity: OrderRow[];
  activityTitle: string;
  activityEmpty: string;
  /** What the card lists, so its "See all" opens the real list (lib/dashboardV3/seeAllLinks.ts). */
  activityKind?: ActivityKind;
  /** Visits for each of the last 7 days, oldest first (for the little trend chart). */
  visitsByDay?: number[];
};

const num = (n: number) => n.toLocaleString("en");

/** Visits (last 7 days) plus the numbers that matter for what the site is for. */
export async function loadSiteStats(site: SiteSummary, variant: TaskVariant): Promise<SiteStats> {
  const id = site.id;
  const since = new Date(Date.now() - 7 * DAY).toISOString();
  const visitTimes = await safe("visits", async () => (await PageView.query.primary({ templateId: id }).between({ createdAt: since }, { createdAt: new Date().toISOString() }).go({ pages: "all", attributes: ["createdAt"] })).data.map((v) => v.createdAt), [] as (string | undefined)[]);
  const visits = visitTimes.length;
  const stats: Stat[] = [{ id: "visits", label: "Visits this week", value: num(visits) }];
  let activity: OrderRow[] = [];
  let activityTitle = "Latest activity";
  let activityEmpty = "Nothing yet. Share your link and the first visitors will show up here.";
  let activityKind: ActivityKind = "none";

  if (variant === "store" || variant === "payments") {
    const [orders, settings] = await Promise.all([
      safe("orders", async () => (await CommerceOrder.query.primary({ templateId: id }).go({ pages: "all" })).data, []),
      safe("currency", async () => (await CommerceSettings.get({ templateId: id }).go()).data, null),
    ]);
    const currency = settings?.currency ?? "NGN";
    const paid = orders.filter((o) => o.status === "PAID");
    const monthAgo = Date.now() - 30 * DAY;
    const month = paid.filter((o) => Date.parse(o.createdAt ?? "") >= monthAgo);
    stats.push({ id: "orders", label: "Orders", value: num(orders.length), hint: `${num(paid.length)} paid` });
    stats.push({ id: "sales", label: "Sales this month", value: formatMoney(month.reduce((s, o) => s + o.amountMinor, 0), currency) });
    activityKind = "orders";
    activityTitle = "Latest orders";
    activityEmpty = "No orders yet. Share your store link with a few friends to get the first one.";
    activity = [...orders]
      .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
      .slice(0, 5)
      .map((o) => ({ id: o.id, who: o.customerName || o.customerEmail, amount: formatMoney(o.amountMinor, currency), when: o.createdAt ?? "", paid: o.status === "PAID" }));
  } else if (variant === "course") {
    const enrolled = await safe("students", async () => (await LmsEnrollment.query.primary({ templateId: id }).go({ pages: "all", attributes: ["email", "enrolledAt"] })).data, []);
    stats.push({ id: "students", label: "Students", value: num(enrolled.length) });
    activityKind = "students";
    activityTitle = "New students";
    activityEmpty = "No students yet. Share your course link to get the first one.";
    activity = [...enrolled].sort((a, b) => (b.enrolledAt ?? "").localeCompare(a.enrolledAt ?? "")).slice(0, 5).map((e) => ({ id: e.email, who: e.email, amount: "", when: e.enrolledAt ?? "", paid: true }));
  } else if (variant === "blog") {
    const posts = await safe("posts", async () => (await BlogPost.query.primary({ templateId: id }).go({ pages: "all", attributes: ["slug", "status"] })).data, []);
    stats.push({ id: "posts", label: "Posts published", value: num(posts.filter((p) => p.status === "PUBLISHED").length) });
    activityEmpty = "Write a post and share it. Readers show up here.";
  } else if (variant !== "app") {
    const subs = await safe("messages", async () => (await FormSubmission.query.primary({ templateId: id }).go({ pages: "all", attributes: ["id", "createdAt", "fields", "formName"] })).data, []);
    stats.push({ id: "messages", label: variant === "link" ? "Link taps" : "Messages and sign-ups", value: num(subs.length) });
    activityKind = "messages";
    activityTitle = "Messages and sign-ups";
    activityEmpty = "Nothing yet. When someone fills in a form on your site, it appears here.";
    activity = [...subs].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")).slice(0, 5).map((m) => ({ id: m.id, who: senderOf(m.fields, m.formName), amount: "", when: m.createdAt ?? "", paid: true }));
  }
  return { stats, activity, activityTitle, activityEmpty, activityKind, visitsByDay: bucketVisitsByDay(visitTimes) };
}
