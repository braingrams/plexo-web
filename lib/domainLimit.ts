// Pure, dependency-free: how many addresses (Plexo subdomains + custom domains) an account
// can have published at once. Custom domains have their own, smaller cap per plan
// (getTierFeatures(plan).maxCustomDomains) — this is the overall address count.

import { toPlanId, type PlanId } from "@/lib/plan/plans";

const PUBLISHED_ADDRESS_LIMIT: Record<PlanId, number> = {
  FREE: 5,
  STARTER: 10,
  PRO: 25,
  ENTERPRISE: 100,
};

export function getDomainLimit(plan: string, customLimit: number | null): number {
  if (customLimit !== null && customLimit !== undefined) {
    return customLimit;
  }
  return PUBLISHED_ADDRESS_LIMIT[toPlanId(plan)];
}
