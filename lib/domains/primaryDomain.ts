type DomainLike = { type?: string | null; active?: boolean | null; createdAt?: string | null };

/**
 * A linked custom domain should read as the site's real address once it's live, not sit
 * behind the auto-provisioned plexopages.com subdomain just because that row was created
 * first. Prefers an active CUSTOM domain, falling back to the oldest row of whichever type
 * remains (SUBDOMAIN rows are provisioned once at publish time, so "oldest" already picks
 * the right one among them).
 */
function domainPriority(a: DomainLike, b: DomainLike): number {
  const aCustom = a.type === "CUSTOM" ? 0 : 1;
  const bCustom = b.type === "CUSTOM" ? 0 : 1;
  if (aCustom !== bCustom) return aCustom - bCustom;
  return (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
}

export function sortDomainsPrimaryFirst<T extends DomainLike>(domains: T[]): T[] {
  return domains.slice().sort(domainPriority);
}

/** Callers that only want a "live" domain should filter to active rows first — this just
 * breaks ties among whatever's passed in, it doesn't apply an active filter itself. */
export function pickPrimaryDomain<T extends DomainLike>(domains: T[]): T | null {
  return sortDomainsPrimaryFirst(domains)[0] ?? null;
}
