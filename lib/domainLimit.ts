// Extracted out of app/api/v1/domains/route.ts (which is Prisma-backed and being cut over)
// into its own pure, dependency-free file — same reasoning as lib/vercelDomains.ts: a plain
// function with nothing to do with the data layer, needed by every already-ported call site
// without pulling in that route's Prisma imports.

export function getDomainLimit(plan: string, customLimit: number | null): number {
  if (customLimit !== null && customLimit !== undefined) {
    return customLimit;
  }
  switch (plan) {
    case "FREE":
      return 5;
    case "PRO":
      return 10;
    case "ULTRA":
    default:
      return 25;
  }
}
