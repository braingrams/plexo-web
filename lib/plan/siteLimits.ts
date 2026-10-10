// Pure planning for what a plan change does to an account's sites. lib/plan/lifecycle.ts
// loads the sites and applies the plan; keeping the decisions here means the rules are
// tested without a database and stay identical for every trigger (Stripe, the trial
// ending, the admin console, the hourly sweep).

export type PlanDomain = {
  id: string;
  templateId: string;
  domain: string;
  type: "SUBDOMAIN" | "CUSTOM";
  /** false = suspended by abuse review — never touched by the plan. */
  active?: boolean | null;
  planDisabledAt?: string | null;
  planFallback?: boolean | null;
};

export type PlanPage = {
  id: string;
  isPublished?: boolean | null;
  planArchivedAt?: string | null;
  updatedAt?: string | null;
};

export type PlanSite = {
  id: string;
  name: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  /** Every page under the homepage, at any depth. */
  pages: PlanPage[];
  /** Only the addresses this account published (their plan governs them). */
  domains: PlanDomain[];
  /** Another account also has this site live — its pages follow that account's plan, so they're left alone. */
  sharedWithOtherPlan?: boolean;
};

/** Reachable by visitors right now. */
export function isDomainLive(d: Pick<PlanDomain, "active" | "planDisabledAt">): boolean {
  return d.active !== false && !d.planDisabledAt;
}

export function isPagePublished(p: Pick<PlanPage, "isPublished">): boolean {
  return p.isPublished !== false;
}

/** The last time anything on the site was edited — the homepage or any of its pages. */
export function siteLastEditedAt(site: PlanSite): string {
  let latest = site.updatedAt ?? site.createdAt ?? "";
  for (const page of site.pages) {
    if ((page.updatedAt ?? "") > latest) latest = page.updatedAt ?? "";
  }
  return latest;
}

/** The site Free keeps online: the most recently edited of the live ones. */
export function chooseSiteToKeep(sites: PlanSite[]): PlanSite | null {
  const live = sites.filter((s) => s.domains.some(isDomainLive));
  if (live.length === 0) return null;
  return [...live].sort((a, b) => {
    const byEdit = siteLastEditedAt(b).localeCompare(siteLastEditedAt(a));
    if (byEdit !== 0) return byEdit;
    const byCreated = (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
    return byCreated !== 0 ? byCreated : a.id.localeCompare(b.id);
  })[0];
}

export type FreePlanChanges = {
  keptSiteId: string | null;
  /** Live addresses to take offline (other sites, and the kept site's custom domains). */
  disableDomainIds: { templateId: string; id: string }[];
  /** Published sub-pages to unpublish — on every site, so whichever is live shows only its homepage. */
  archivePageIds: string[];
  /** The kept site's Plexo addresses that an earlier Free choice switched off — back on. */
  enableDomainIds: { templateId: string; id: string }[];
  /** The kept site is left with no Plexo address: give it one. */
  needsFallbackSubdomain: boolean;
};

/**
 * Free = one live site, homepage only, on a Plexo address. Nothing is deleted: pages are
 * unpublished and addresses switched off, each marked so restore can bring back exactly
 * what this took away. `keepSiteId` overrides the default choice (the owner picked which
 * site stays live).
 */
export function planFreeLimits(sites: PlanSite[], keepSiteId?: string | null): FreePlanChanges {
  const keep = (keepSiteId && sites.find((s) => s.id === keepSiteId)) || chooseSiteToKeep(sites);
  const disableDomainIds: FreePlanChanges["disableDomainIds"] = [];
  const archivePageIds: string[] = [];
  let needsFallbackSubdomain = false;
  let enableDomainIds: FreePlanChanges["enableDomainIds"] = [];

  for (const site of sites) {
    const isKept = keep?.id === site.id;
    for (const d of site.domains) {
      if (!isDomainLive(d)) continue;
      if (!isKept || d.type === "CUSTOM") disableDomainIds.push({ templateId: d.templateId, id: d.id });
    }
    if (site.sharedWithOtherPlan) continue;
    for (const page of site.pages) {
      if (isPagePublished(page)) archivePageIds.push(page.id);
    }
  }

  if (keep) {
    // A Plexo address that's off only because of an earlier Free choice comes back on;
    // with none at all, the kept site needs a fresh one.
    enableDomainIds = plexoAddressesToReenable(keep);
    needsFallbackSubdomain = !keep.domains.some((d) => d.type === "SUBDOMAIN" && d.active !== false);
  }

  return { keptSiteId: keep?.id ?? null, disableDomainIds, archivePageIds, enableDomainIds, needsFallbackSubdomain };
}

/**
 * When the owner switches which site Free keeps online, the chosen site's Plexo
 * addresses that the plan switched off come back on.
 */
export function plexoAddressesToReenable(site: PlanSite): { templateId: string; id: string }[] {
  return site.domains
    .filter((d) => d.type === "SUBDOMAIN" && d.active !== false && !!d.planDisabledAt)
    .map((d) => ({ templateId: d.templateId, id: d.id }));
}

export type RestoreChanges = {
  enableDomainIds: { templateId: string; id: string }[];
  republishPageIds: string[];
};

/** Back to exactly how it was before the downgrade: only what the plan took away. */
export function planRestore(sites: PlanSite[]): RestoreChanges {
  const enableDomainIds: RestoreChanges["enableDomainIds"] = [];
  const republishPageIds: string[] = [];
  for (const site of sites) {
    for (const d of site.domains) if (d.planDisabledAt) enableDomainIds.push({ templateId: d.templateId, id: d.id });
    for (const p of site.pages) if (p.planArchivedAt) republishPageIds.push(p.id);
  }
  return { enableDomainIds, republishPageIds };
}

/** Live sites other than `templateId` — what a Free account would have to give up to put `templateId` live. */
export function otherLiveSites(sites: PlanSite[], templateId: string): PlanSite[] {
  return sites.filter((s) => s.id !== templateId && s.domains.some(isDomainLive));
}

// ── Links that lead to other pages ──────────────────────────────────────────────────────

export type SecondaryLink = { href: string; label: string };

const NON_PAGE_HREF = /^(#|mailto:|tel:|sms:|javascript:|data:|\{\{)/i;
const FILE_HREF = /\.(png|jpe?g|gif|webp|svg|ico|pdf|zip|css|js|json|xml|txt|mp4|mp3|woff2?|ttf)(\?|#|$)/i;

/**
 * Links in a page that open another page of the same site ("/about", "contact.html",
 * "/blog/…") — on Free those lead back to the homepage, so the editor warns about them.
 * Works on any served HTML (builder output or an uploaded page). External links, anchors
 * on the same page, files and links to the homepage itself are left out.
 */
export function findSecondaryPageLinks(html: string, siteHosts: string[] = []): SecondaryLink[] {
  const hosts = new Set(siteHosts.map((h) => h.toLowerCase()));
  const found = new Map<string, SecondaryLink>();
  const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchorRe.exec(html)) !== null) {
    const hrefMatch = match[1].match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const raw = (hrefMatch?.[1] ?? hrefMatch?.[2] ?? hrefMatch?.[3] ?? "").trim().replace(/&amp;/g, "&");
    if (!raw || NON_PAGE_HREF.test(raw)) continue;
    let path: string;
    if (/^(https?:)?\/\//i.test(raw)) {
      let url: URL;
      try {
        url = new URL(raw.startsWith("//") ? `https:${raw}` : raw);
      } catch {
        continue;
      }
      if (!hosts.has(url.hostname.toLowerCase())) continue; // another website
      path = url.pathname;
    } else if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
      continue; // some other scheme
    } else {
      path = raw.split(/[?#]/)[0];
      if (!path.startsWith("/")) path = `/${path.replace(/^\.\//, "")}`;
    }
    const normalized = path.replace(/\/+$/, "") || "/";
    if (normalized === "/" || /^\/index(\.html?)?$/i.test(normalized) || FILE_HREF.test(normalized)) continue;
    if (found.has(normalized)) continue;
    const label = match[2].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || normalized;
    found.set(normalized, { href: normalized, label });
  }
  return [...found.values()];
}
