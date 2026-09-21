type DomainLike = { type?: string | null; active?: boolean | null; createdAt?: string | null };

/**
 * A linked custom domain should read as the site's real address once it's live, not sit
 * behind the auto-provisioned plexopages.com subdomain just because that row was created
 * first. Prefers active domains over pending/inactive ones, then prefers CUSTOM over
 * SUBDOMAIN, then falls back to the oldest row of whichever type remains (SUBDOMAIN rows
 * are provisioned once at publish time, so "oldest" already picks the right one among
 * them).
 */
function domainPriority(a: DomainLike, b: DomainLike): number {
  const aActive = a.active ? 0 : 1;
  const bActive = b.active ? 0 : 1;
  if (aActive !== bActive) return aActive - bActive;

  const aCustom = a.type === "CUSTOM" ? 0 : 1;
  const bCustom = b.type === "CUSTOM" ? 0 : 1;
  if (aCustom !== bCustom) return aCustom - bCustom;
  return (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
}

export function sortDomainsPrimaryFirst<T extends DomainLike>(domains: T[]): T[] {
  return domains.slice().sort(domainPriority);
}

export function pickPrimaryDomain<T extends DomainLike>(domains: T[]): T | null {
  return sortDomainsPrimaryFirst(domains)[0] ?? null;
}
