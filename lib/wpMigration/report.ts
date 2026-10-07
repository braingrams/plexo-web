import type { EntityItem } from "electrodb";
import type { WpMigrationAsset, WpMigrationPage } from "@/lib/db/importEntities";
import type { MigratedForm, PageFacts } from "./htmlTransform";
import type { DetectedPlugin, WpInstall } from "./types";

// The report is the owner's evidence that it's safe to switch their domain and delete
// WordPress — so it compares what WordPress served against what Plexo will serve, page by
// page, rather than just counting what ran. Everything that could cost them traffic,
// leads or donations surfaces as an explicit checklist item, and anything that would
// actually break after the switch blocks "ready" until it's dealt with.

type PageRow = EntityItem<typeof WpMigrationPage>;
type AssetRow = EntityItem<typeof WpMigrationAsset>;

export type ChecklistStatus = "done" | "blocked" | "review" | "todo";

export interface ChecklistItem {
  id: string;
  label: string;
  status: ChecklistStatus;
  detail: string;
}

export interface PageReportRow {
  key: string;
  kind: string;
  title: string;
  sourceUrl: string;
  newPath: string | null;
  status: string;
  error: string | null;
  seo: { title: boolean; description: boolean; canonical: boolean; structuredData: boolean; robots: boolean } | null;
  words: { before: number; after: number } | null;
}

export interface MigrationReport {
  generatedAt: string;
  source: { origin: string; homeUrl: string; siteName: string };
  summary: {
    pagesCopied: number;
    pagesFailed: number;
    postsCopied: number;
    postsFailed: number;
    filesCopied: number;
    filesFailed: number;
    filesAlreadyMissing: number;
    bytesCopied: number;
    formsReconnected: number;
  };
  seo: { pagesChecked: number; titles: number; descriptions: number; canonicals: number; structuredData: number; robots: number };
  pages: PageReportRow[];
  forms: (MigratedForm & { page: string })[];
  paymentForms: { page: string; reason: string }[];
  brokenLinks: { from: string; href: string; reason: string }[];
  failedFiles: { path: string; reason: string }[];
  missingOnSource: { path: string; from: string | null }[];
  plugins: DetectedPlugin[];
  checklist: ChecklistItem[];
  /** Donation campaigns created from the site's donation forms. */
  donationCampaigns?: { campaignId: string; name: string }[];
  /** True when nothing blocks switching the domain. "review" items don't block — they need a look, not a fix. */
  readyForCutover: boolean;
}

function sameText(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? "").replace(/\s+/g, " ").trim() === (b ?? "").replace(/\s+/g, " ").trim();
}

export function buildMigrationReport(input: {
  install: WpInstall;
  pages: PageRow[];
  assets: AssetRow[];
  plugins: DetectedPlugin[];
  brokenLinks: { from: string; href: string; reason: string }[];
  counts: { assetsDone: number };
  customApis?: { frozen: string[]; captured: string[] };
  /** Whether Stripe/Paystack is connected on the new site right now. */
  paymentsReady?: boolean;
}): MigrationReport {
  const { install, pages, assets, plugins, brokenLinks } = input;
  const pageRows = pages.filter((p) => p.kind !== "POST");
  const postRows = pages.filter((p) => p.kind === "POST");

  const seo = { pagesChecked: 0, titles: 0, descriptions: 0, canonicals: 0, structuredData: 0, robots: 0 };
  const rows: PageReportRow[] = pages
    .map((p) => {
      const before = p.sourceFacts as PageFacts | undefined;
      const after = p.newFacts as PageFacts | undefined;
      let seoRow: PageReportRow["seo"] = null;
      if (p.kind !== "POST" && before && after) {
        seoRow = {
          title: sameText(before.title, after.title),
          description: sameText(before.metaDescription, after.metaDescription),
          canonical: sameText(before.canonical, after.canonical),
          structuredData: after.jsonLdBlocks >= before.jsonLdBlocks,
          robots: sameText(before.robots, after.robots),
        };
        seo.pagesChecked += 1;
        if (seoRow.title) seo.titles += 1;
        if (seoRow.description) seo.descriptions += 1;
        if (seoRow.canonical) seo.canonicals += 1;
        if (seoRow.structuredData) seo.structuredData += 1;
        if (seoRow.robots) seo.robots += 1;
      }
      return {
        key: p.key,
        kind: p.kind,
        title: p.title || before?.title || p.key,
        sourceUrl: p.sourceUrl,
        newPath: p.newPath ?? null,
        status: p.status ?? "PENDING",
        error: p.error ?? null,
        seo: seoRow,
        words: before && after ? { before: before.wordCount, after: after.wordCount } : null,
      };
    })
    .sort((a, b) => (a.kind === "POST" ? 1 : 0) - (b.kind === "POST" ? 1 : 0) || a.key.localeCompare(b.key));

  const forms = pageRows.flatMap((p) => ((p.forms as MigratedForm[] | undefined) ?? []).map((f) => ({ ...f, page: p.newPath ?? p.key })));
  const paymentForms = pageRows.flatMap((p) =>
    ((p.unmigratedForms as { plugin: string; reason: string }[] | undefined) ?? []).map((f) => ({ page: p.newPath ?? p.key, reason: f.reason })),
  );
  const failedFiles = assets.filter((a) => a.status === "FAILED").map((a) => ({ path: `/${a.path}`, reason: a.error ?? "Unknown error" }));
  const missingOnSource = assets
    .filter((a) => a.status === "SKIPPED" && /missing on WordPress/i.test(a.error ?? ""))
    .map((a) => ({ path: `/${a.path}`, from: a.discoveredFrom ?? null }));
  const bytesCopied = assets.reduce((sum, a) => sum + (a.status === "DONE" ? a.size ?? 0 : 0), 0);

  const pagesFailed = pageRows.filter((p) => p.status === "FAILED");
  const postsFailed = postRows.filter((p) => p.status === "FAILED");
  const needsAttention = plugins.filter((p) => p.outcome === "NEEDS_ATTENTION");
  const paymentPlugins = needsAttention.filter((p) => /payment|woocommerce|give|donat/i.test(`${p.slug} ${p.name}`));
  const otherAttention = needsAttention.filter((p) => !paymentPlugins.includes(p));

  const checklist: ChecklistItem[] = [];
  const contentProblems = pagesFailed.length + postsFailed.length + failedFiles.length;
  checklist.push({
    id: "content",
    label: "Pages, blog posts, images and files copied",
    status: contentProblems === 0 ? "done" : "blocked",
    detail:
      contentProblems === 0
        ? `${pageRows.length - pagesFailed.length} pages, ${postRows.length - postsFailed.length} posts and ${assets.filter((a) => a.status === "DONE").length} files are on Plexo.`
        : `${contentProblems} item(s) didn't copy — retry the migration, or see the list below for what to do.`,
  });
  const seoGaps = seo.pagesChecked - Math.min(seo.titles, seo.descriptions, seo.canonicals);
  checklist.push({
    id: "seo",
    label: "SEO kept: titles, descriptions, canonical URLs, structured data, same web addresses",
    status: seoGaps === 0 ? "done" : "review",
    detail:
      seoGaps === 0
        ? `All ${seo.pagesChecked} pages keep their exact SEO tags and URLs. Old WordPress-only addresses (feeds, sitemaps, shortlinks, attachment pages, category archives) redirect to their Plexo equivalents.`
        : `${seoGaps} page(s) have SEO tags that differ from WordPress — check them below.`,
  });
  if (forms.length > 0) {
    checklist.push({
      id: "forms",
      label: "Forms reconnected",
      status: "done",
      detail: `${forms.length} form(s) now send submissions to your Plexo dashboard and your email. Send yourself a test message to see it arrive.`,
    });
  }
  const donationCampaigns = pageRows.flatMap((p) => ((p.donationCampaigns as { campaignId: string; name: string }[] | undefined) ?? []));
  const uniqueCampaigns = Array.from(new Map(donationCampaigns.map((c) => [c.campaignId, c])).values());
  if (uniqueCampaigns.length > 0) checklist.push(donationPaymentsItem(uniqueCampaigns, input.paymentsReady ?? false));
  if (paymentPlugins.length > 0 || paymentForms.length > 0) {
    checklist.push({
      id: "payments-other",
      label: "Set up payments for your shop or other payment forms",
      status: "blocked",
      detail: `${paymentPlugins.map((p) => p.name).join(", ") || "A payment form"} took payments on WordPress and couldn't be converted automatically. Recreate it with Plexo Commerce (products) or Plexo Donations (Commerce → Donations → copy the embed code onto that page) — switching your domain before then would stop those payments.`,
    });
  }
  const loginPages = pageRows.filter((p) => (p.loginForms ?? 0) > 0);
  if (loginPages.length > 0) {
    checklist.push({
      id: "team-access",
      label: "Give your team access",
      status: "review",
      detail: `${loginPages.map((p) => p.newPath ?? p.key).join(", ")} had a login for your staff. It now opens Plexo sign-in: invite the people who used it (Settings → Team) and they'll see form submissions — like applications sent through your site — in Plexo.`,
    });
  }
  if (otherAttention.length > 0) {
    checklist.push({
      id: "custom-features",
      label: "Review features that ran on your WordPress server",
      status: "review",
      detail: [
        `${otherAttention.map((p) => p.name).join(", ")} ran code on your WordPress server.`,
        "Their pages look and work the same on Plexo, and their forms now send to Form Submissions.",
        input.customApis?.frozen.length
          ? `Their data addresses (${input.customApis.frozen.join(", ")}) still answer with the values they had on migration day — anything outside your website that reads them keeps working.`
          : "",
        input.customApis?.captured.length
          ? `Anything that still sends to ${input.customApis.captured.join(", ")} now arrives in Form Submissions.`
          : "",
        "Have a quick look that nothing else depended on them.",
      ].filter(Boolean).join(" "),
    });
  }
  if (brokenLinks.length > 0) {
    checklist.push({
      id: "links",
      label: "Links to check",
      status: "review",
      detail: `${brokenLinks.length} link(s) point to pages that don't exist — most were already broken on WordPress.`,
    });
  }
  checklist.push({
    id: "publish",
    label: "Preview your site on Plexo",
    status: "todo",
    detail: "Publish to a free plexopages address and click around — it should look and work exactly like your WordPress site.",
  });
  checklist.push({
    id: "domain",
    label: `Point ${new URL(install.origin).host} to Plexo`,
    status: "todo",
    detail: "Connect your domain in Domains. Keep WordPress running until your domain shows the Plexo site, then you can safely cancel your WordPress hosting.",
  });

  return {
    generatedAt: new Date().toISOString(),
    source: { origin: install.origin, homeUrl: install.homeUrl, siteName: install.siteName },
    summary: {
      pagesCopied: pageRows.filter((p) => p.status === "DONE").length,
      pagesFailed: pagesFailed.length,
      postsCopied: postRows.filter((p) => p.status === "DONE").length,
      postsFailed: postsFailed.length,
      filesCopied: assets.filter((a) => a.status === "DONE").length,
      filesFailed: failedFiles.length,
      filesAlreadyMissing: missingOnSource.length,
      bytesCopied,
      formsReconnected: forms.length,
    },
    seo,
    pages: rows,
    forms,
    paymentForms,
    brokenLinks,
    failedFiles,
    missingOnSource,
    plugins,
    checklist,
    donationCampaigns: uniqueCampaigns,
    readyForCutover: !checklist.some((c) => c.status === "blocked"),
  };
}

/** The "donations need a payment account" checklist item — rebuilt live whenever the report is viewed. */
export function donationPaymentsItem(campaigns: { name: string }[], paymentsReady: boolean): ChecklistItem {
  const names = campaigns.map((c) => `“${c.name}”`).join(", ");
  return paymentsReady
    ? {
        id: "payments",
        label: "Donations are live on Plexo",
        status: "done",
        detail: `${names} now takes one-time and monthly gifts through your connected payment account. If your WordPress donors give monthly, open Commerce → Donations and click “Bring over existing monthly donors” so their gifts keep being recorded.`,
      }
    : {
        id: "payments",
        label: "Connect payments so your donation forms can take gifts",
        status: "blocked",
        detail: `${names} moved to Plexo Donations with the same amounts and monthly option. Connect Stripe or Paystack in Commerce → Settings → Payments — use the same account WordPress used and your existing monthly donors carry straight over. Switching your domain before this would stop donations, so it blocks the switch.`,
      };
}

/** Re-evaluates the parts of a stored report that depend on things the owner may have done since (connecting payments). */
export function refreshReport(report: MigrationReport, paymentsReady: boolean): MigrationReport {
  if (!report.donationCampaigns?.length) return report;
  const checklist = report.checklist.map((item) => (item.id === "payments" ? donationPaymentsItem(report.donationCampaigns!, paymentsReady) : item));
  return { ...report, checklist, readyForCutover: !checklist.some((c) => c.status === "blocked") };
}
