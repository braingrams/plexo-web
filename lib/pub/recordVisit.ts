import { createHash, randomUUID } from "node:crypto";
import { PublishedDomain, Template } from "@/lib/db/contentEntities";
import { PageView } from "@/lib/db/opsEntities";
import { recordPageViewRollup } from "@/lib/analyticsRollup";
import { consentRequiredFor, visitorCountry } from "@/lib/consent/regions";
import { extractGeoFromHeaders, parseUserAgent } from "@/server/analytics";
import { throttle } from "@/lib/appRuntime/http";

/**
 * Records one visit sent by the page's own counting script (lib/pub/visitBeacon.ts). Everything is checked on the
 * server: the page id the browser sent is only believed when it really belongs to the site on this address, so nobody
 * can add visits to someone else's pages.
 */

const SITE_TTL_MS = 5 * 60 * 1000;
const siteCache = new Map<string, { siteId: string | null; at: number }>();
const pageCache = new Map<string, boolean>();

async function siteIdForDomain(domain: string): Promise<string | null> {
  const hit = siteCache.get(domain);
  if (hit && Date.now() - hit.at < SITE_TTL_MS) return hit.siteId;
  const { data } = await PublishedDomain.query.byDomain({ domain }).go({ pages: "all" });
  const row = data.find((d) => d.active !== false && !d.planDisabledAt);
  const siteId = row?.templateId ?? null;
  siteCache.set(domain, { siteId, at: Date.now() });
  if (siteCache.size > 5000) siteCache.delete(siteCache.keys().next().value!);
  return siteId;
}

/** True when `pageId` is the site itself or one of its pages (walking up through parents, a few levels at most). */
async function pageBelongsToSite(pageId: string, siteId: string): Promise<boolean> {
  const key = `${siteId}:${pageId}`;
  const known = pageCache.get(key);
  if (known !== undefined) return known;
  let current: string | undefined = pageId;
  let belongs = false;
  for (let i = 0; i < 8 && current; i++) {
    if (current === siteId) {
      belongs = true;
      break;
    }
    const lookup: { data?: { parentId?: string | null } | null } = await Template.get({ id: current }).go();
    current = lookup.data?.parentId ?? undefined;
  }
  pageCache.set(key, belongs);
  if (pageCache.size > 20000) pageCache.delete(pageCache.keys().next().value!);
  return belongs;
}

export type VisitInput = { domain: string; body: unknown; headers: Headers };
export type VisitOutcome = "counted" | "ignored" | "limited";

const BOT = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|pingdom|uptime|monitor|facebookexternalhit|preview/i;

/**
 * The visitor fingerprint (a one-way hash of the address) is only kept when it is allowed: not for visitors in places
 * that need consent first (the same list the cookie notice uses), and not when the browser asks not to be tracked.
 * Those visits still count towards the totals, so the numbers stay honest without recognising anyone.
 */
export function mayRecognise(headers: Pick<Headers, "get">, doNotTrack: boolean): boolean {
  return !doNotTrack && !consentRequiredFor(visitorCountry(headers));
}

export async function recordVisit(input: VisitInput): Promise<VisitOutcome> {
  const raw = input.body && typeof input.body === "object" ? (input.body as Record<string, unknown>) : null;
  const pageId = typeof raw?.p === "string" ? raw.p : "";
  if (!/^[0-9a-f-]{20,40}$/i.test(pageId)) return "ignored";
  const ua = input.headers.get("user-agent");
  if (!ua || BOT.test(ua)) return "ignored";
  const ip = input.headers.get("x-forwarded-for")?.split(",")[0].trim() || input.headers.get("x-real-ip") || "0.0.0.0";
  const ipHash = createHash("sha256").update(ip).digest("hex");
  // One visitor opening the same page over and over is not a hundred visits.
  if (!throttle(`visit:${ipHash}:${pageId}`, 20)) return "limited";

  const siteId = await siteIdForDomain(input.domain);
  if (!siteId || !(await pageBelongsToSite(pageId, siteId))) return "ignored";

  const recognise = mayRecognise(input.headers, raw?.g === 1);
  const { deviceType, browser, os } = parseUserAgent(ua);
  const { country, region, city } = extractGeoFromHeaders(input.headers);
  const createdAt = new Date();
  await Promise.allSettled([
    PageView.create({
      id: randomUUID(),
      templateId: pageId,
      domain: input.domain,
      ipHash: recognise ? ipHash : undefined,
      userAgent: recognise ? ua : undefined,
      deviceType: deviceType ?? undefined,
      browser: browser ?? undefined,
      os: os ?? undefined,
      country: country ?? undefined,
      region: recognise ? region ?? undefined : undefined,
      city: recognise ? city ?? undefined : undefined,
    }).go(),
    recordPageViewRollup({ createdAt, templateId: pageId, deviceType, browser, os }),
  ]);
  return "counted";
}
