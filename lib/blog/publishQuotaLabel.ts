// Pure formatter split out of publishQuota.ts so client components can import it
// without pulling in lib/db/contentEntities (server-only DynamoDB access).
export function formatPublishedQuotaLabel(
  count: number,
  limit: number | null,
): string {
  return limit === null ? "Unlimited" : `${count} / ${limit} published`;
}
