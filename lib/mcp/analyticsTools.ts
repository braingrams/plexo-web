import type { resolveUser } from "@/lib/auth/resolveUser";
import { Template } from "@/lib/db/contentEntities";
import { SiteGoogleAnalytics } from "@/lib/db/opsEntities";
import { ANALYTICS_UPGRADE_MESSAGE, canUseGoogleAnalytics } from "@/lib/googleAnalytics/access";
import { disconnect, forgetTag, getConnection, reportForSite, siteUrlFor, startManaged } from "@/lib/googleAnalytics/connection";
import { buildInsights } from "@/lib/googleAnalytics/insights";
import { EMAIL_PATTERN, grantAccess, isManagedAvailable, ManagedUnavailableError } from "@/lib/googleAnalytics/managed";
import { GoogleApiError } from "@/lib/googleAnalytics/dataClient";
import { loadConsentSettings, normalizeConsentInput, saveConsentSettings } from "@/lib/consent/settings";
import type { RangeDays } from "@/lib/googleAnalytics/types";

type ResolvedUser = NonNullable<Awaited<ReturnType<typeof resolveUser>>>;

// Detailed visitor numbers (Google Analytics run by Plexo) and the cookie notice: parity with the Visits tab. Paid plans only.

const templateId = { type: "string", description: "The site's home page id (see list_landing_pages)." };

export const ANALYTICS_MCP_TOOLS = [
  {
    name: "get_analytics",
    description:
      "Plexo's own visit records, the \"Plexo records\" view of the Visits tab. Without templateId: every site side by side (visits in the last 7 days, address, live or draft), best first, so it answers \"which site performs best\". With templateId (a site's home page id): that site's visits per day, countries, devices, browsers, operating systems and its most recent visits. days is 7, 14 or 28 (default 14, used with templateId). Needs Starter or above. This is separate from get_site_visits (Google Analytics).",
    inputSchema: { type: "object", properties: { templateId: { type: "string", description: "Optional. A site's home page id (see list_landing_pages). Leave out to compare all sites." }, days: { type: "number", enum: [7, 14, 28] } } },
  },
  {
    name: "get_site_visits",
    description:
      "Detailed visitor numbers for a site from its Google Analytics (visitors, pages looked at, top pages, where people came from, countries, devices) with plain-language takeaways. Works for numbers Plexo runs and for a Google account the owner connected themselves. Needs a paid plan and the numbers connected (turn_on_visitor_numbers for Plexo's); a site with none returns connected:false, not an error. Data usually appears a few hours after switching on. For simple counts on any plan use get_analytics.",
    inputSchema: { type: "object", properties: { templateId, days: { type: "number", enum: [7, 28, 90], description: "Default 28." } }, required: ["templateId"] },
  },
  {
    name: "turn_on_visitor_numbers",
    description:
      "Switches on detailed visitor numbers for a published site in one step. Plexo sets up and owns the Google Analytics property, so the owner does NOT need a Google account. Adds the counting to the site; visitors in Europe, the UK, Switzerland and Brazil see a small cookie notice first (see set_cookie_notice). Needs a paid plan.",
    inputSchema: { type: "object", properties: { templateId }, required: ["templateId"] },
  },
  {
    name: "turn_off_visitor_numbers",
    description: "Stops detailed visitor counting on a site and removes the counting from its pages. Simple visit counts (get_analytics) keep working.",
    inputSchema: { type: "object", properties: { templateId }, required: ["templateId"] },
  },
  {
    name: "share_visitor_numbers_with_google",
    description: "Optional: gives the owner's own Google account access to the site's Plexo-managed Google Analytics property, so they can see it at analytics.google.com. Plexo keeps counting too. Needs the numbers switched on first.",
    inputSchema: { type: "object", properties: { templateId, email: { type: "string", description: "The Google account email to share with." } }, required: ["templateId", "email"] },
  },
  {
    name: "set_cookie_notice",
    description:
      "Shows or changes the cookie notice visitors in Europe, the UK, Switzerland and Brazil see before the visitor numbers start counting. On by default; nobody else ever sees it. Pass only what should change. Without any settings it returns the current ones.",
    inputSchema: {
      type: "object",
      properties: {
        templateId,
        enabled: { type: "boolean" },
        message: { type: "string", description: "Up to 240 characters." },
        acceptLabel: { type: "string" },
        declineLabel: { type: "string" },
        position: { type: "string", enum: ["bar", "card"], description: "A bar along the bottom, or a small card in the corner." },
        accentColor: { type: "string", description: "A #rrggbb colour, or empty to follow the site's brand." },
      },
      required: ["templateId"],
    },
  },
];

export const ANALYTICS_TOOL_NAMES = new Set(ANALYTICS_MCP_TOOLS.map((t) => t.name));

async function handlePlexoRecords(args: any, resolved: ResolvedUser): Promise<any> {
  // Loaded only when the tool runs, so the rest of this module stays light to import.
  const [{ getTierFeatures }, { loadHubSiteCards, loadHubVisits }] = await Promise.all([import("@/lib/subscription"), import("@/lib/dashboardV3/hubData")]);
  if (!getTierFeatures(resolved.subscriptionPlan).analyticsEnabled) throw new Error("Visitor numbers come with the Starter plan and above. Upgrade to see who visits your sites.");
  const id = typeof args?.templateId === "string" ? args.templateId.trim() : "";
  const days = [7, 14, 28].includes(Number(args?.days)) ? Number(args.days) : 14;
  const sites = await loadHubSiteCards(resolved.organizationId, resolved.userId);
  if (id) {
    const site = sites.find((s) => s.id === id);
    if (!site) throw new Error(`No site found with id "${id}" in this account. Use a site's home page id from list_landing_pages.`);
    const v = await loadHubVisits(site.id, days);
    return {
      site: site.name,
      address: site.address,
      source: "Plexo records",
      totalVisits: v.total,
      perDay: v.days,
      countries: v.countries,
      devices: v.devices,
      browsers: v.browsers,
      operatingSystems: v.os,
      recentVisits: (v.recent ?? []).slice(0, 10).map((r) => ({ when: r.createdAt, where: [r.city, r.country].filter(Boolean).join(", ") || null, device: r.deviceType, browser: r.browser })),
    };
  }
  const ranked = (
    await Promise.all(
      sites.map(async (s) => {
        const base = { siteId: s.id, name: s.name, address: s.address, status: s.status, visitsLast7Days: s.visits7d };
        if (!s.visits7d) return base;
        const v = await loadHubVisits(s.id, 7).catch(() => null);
        const top = (r?: { name: string; value: number }[]) => (r?.[0] ? `${r[0].name} (${r[0].value})` : null);
        return { ...base, topCountries: (v?.countries ?? []).slice(0, 3), topDevice: top(v?.devices), topBrowser: top(v?.browsers), topOperatingSystem: top(v?.os) };
      }),
    )
  ).sort((a, b) => b.visitsLast7Days - a.visitsLast7Days);
  return { source: "Plexo records", sites: ranked, best: ranked[0]?.visitsLast7Days ? ranked[0].name : null, note: "Pass a site's id as templateId for its full countries, devices, browsers and systems." };
}

export async function handleAnalyticsTool(toolName: string, args: any, resolved: ResolvedUser): Promise<any> {
  if (toolName === "get_analytics") return handlePlexoRecords(args, resolved);
  const id = typeof args?.templateId === "string" ? args.templateId.trim() : "";
  if (!id) throw new Error("templateId is required — pass the site's home page id (see list_landing_pages).");
  const { data: site } = await Template.get({ id }).go();
  if (!site || site.organizationId !== resolved.organizationId || site.parentId) {
    throw new Error(`No site found with id "${id}" in this account. Use a site's home page id from list_landing_pages.`);
  }
  const paid = canUseGoogleAnalytics(resolved.subscriptionPlan);

  if (toolName === "turn_off_visitor_numbers") {
    await disconnect(site.id);
    return { ok: true, next: "Off. The counting is removed from the site's pages within a minute. Simple visit counts still work." };
  }
  if (toolName === "set_cookie_notice") {
    const current = await loadConsentSettings(site.id);
    const { templateId: _t, ...changes } = args ?? {};
    if (Object.keys(changes).length === 0) return { settings: current, who: "Visitors in Europe, the UK, Switzerland and Brazil." };
    const result = normalizeConsentInput(changes, current);
    if (!result.ok) throw new Error(result.error);
    await saveConsentSettings({ id: site.id, organizationId: site.organizationId }, result.settings);
    forgetTag(site.id);
    return { settings: result.settings, next: "Saved. It shows on the site within a minute." };
  }

  if (!paid) throw new Error(ANALYTICS_UPGRADE_MESSAGE);

  if (toolName === "turn_on_visitor_numbers") {
    if (!(await siteUrlFor(site.id))) throw new Error("Publish the site first. Counting starts from its web address.");
    if (!isManagedAvailable()) throw new Error("Detailed visitor numbers aren't switched on in Plexo yet. Simple visit counts (get_analytics) keep working.");
    try {
      await startManaged({ id: site.id, organizationId: site.organizationId }, resolved.userId);
    } catch (err) {
      if (err instanceof ManagedUnavailableError) throw new Error("Detailed numbers are very busy right now. Simple visit counts keep working. Try again in a day or two.");
      throw err;
    }
    return { ok: true, next: "On. Data usually appears in a few hours. Visitors in Europe will see a small cookie notice (set_cookie_notice changes how it looks)." };
  }

  const conn = await getConnection(site.id);
  if (toolName === "share_visitor_numbers_with_google") {
    if (!conn || conn.mode !== "managed" || !conn.propertyName) throw new Error("Switch on the numbers first (turn_on_visitor_numbers). Sharing only applies to numbers Plexo manages.");
    const email = typeof args?.email === "string" ? args.email.trim().toLowerCase() : "";
    if (!EMAIL_PATTERN.test(email)) throw new Error("That doesn't look like an email address. Use the email the owner signs in to Google with.");
    try {
      await grantAccess(conn.propertyName, email);
    } catch (err) {
      if (err instanceof GoogleApiError && err.status === 400) throw new Error("Google doesn't know that email as a Google account.");
      throw new Error("We couldn't share it just now. Please try again in a minute.");
    }
    await SiteGoogleAnalytics.patch({ templateId: site.id }).set({ handedOverTo: email, handedOverAt: new Date().toISOString() }).go();
    return { ok: true, next: `Shared with ${email}. They can open analytics.google.com with that account.` };
  }

  // get_site_visits
  // Not being connected is an answer, not a failure: a result (not an error) keeps it from showing as a red "didn't work" step when SOL checks several sites.
  if (!conn || !conn.measurementId) return { connected: false, site: site.name, note: "Detailed visitor numbers (Plexo's or the owner's own Google account) aren't connected for this site. turn_on_visitor_numbers switches on Plexo's. Simple visit counts are in get_analytics." };
  const days = ([7, 28, 90].includes(Number(args?.days)) ? Number(args.days) : 28) as RangeDays;
  try {
    const report = await reportForSite(conn, site.id, days);
    const fresh = report.totals.visitors === 0 && Date.now() - new Date(conn.connectedAt ?? 0).getTime() < 48 * 3600 * 1000;
    return { report, insights: buildInsights(report).map((i) => i.text), ...(fresh ? { note: "Counting only just started. Data usually appears in a few hours." } : {}) };
  } catch {
    throw new Error("Couldn't get the numbers just now. Simple visit counts (get_analytics) still work. Try again in a minute.");
  }
}
