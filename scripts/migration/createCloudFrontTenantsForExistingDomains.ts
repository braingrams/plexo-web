/**
 * One-off (but safely re-runnable) catch-up: creates a real CloudFront distribution
 * tenant for every existing CUSTOM PublishedDomain row that predates the CloudFront SaaS
 * Manager cutover. app/api/v1/domains/route.ts's addCloudFrontDomain() has only ever been
 * exercised by domains connected AFTER that cutover — every CUSTOM domain that already
 * existed in DynamoDB (migrated from Postgres) has a row claiming it's connected, but no
 * matching AWS::CloudFront::DistributionTenant, confirmed via
 * `aws cloudfront list-distribution-tenants` returning nothing for
 * empowermentalwellnessclinic.com despite its PublishedDomain row saying
 * dnsVerified: true.
 *
 * Safe to run against a live environment: creating a tenant doesn't touch the domain's
 * existing DNS or traffic at all — nothing routes through it until that domain's own DNS
 * is repointed at the connection group's routing endpoint, a separate, later, per-domain
 * step only whoever controls that specific domain can take.
 *
 * Idempotent — addCloudFrontDomain() already treats EntityAlreadyExists as success, so
 * re-running this after a partial failure or once new CUSTOM domains accumulate is safe.
 *
 * Usage: tsx scripts/migration/createCloudFrontTenantsForExistingDomains.ts [--dry-run]
 */
import { addCloudFrontDomain } from "@/lib/cloudfrontDomains";
import { docClient, TABLES } from "@/lib/db/client";

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");

  // PublishedDomain has no cross-template index (see its own comment in
  // contentEntities.ts) — a full table scan filtered to type=CUSTOM is the only way to
  // find every one regardless of which template it belongs to, same reasoning
  // app/dashboard/page.tsx already accepts for this same entity's own "no org-wide index"
  // limitation. Fine at this scale (single low-thousands-row table, one-off script).
  // A single .scan() call only returns up to 1MB of raw table data (before the filter is
  // even applied), not the whole table — must page through every ExclusiveStartKey or
  // this silently misses everything past the first page.
  const domains: Array<{ domain: string; templateId: string }> = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;
  do {
    const page = await docClient.scan({
      TableName: TABLES.content,
      FilterExpression: "#t = :t",
      ExpressionAttributeNames: { "#t": "type" },
      ExpressionAttributeValues: { ":t": "CUSTOM" },
      ExclusiveStartKey: lastEvaluatedKey,
    });
    domains.push(...((page.Items ?? []) as Array<{ domain: string; templateId: string }>));
    lastEvaluatedKey = page.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  console.log(`Found ${domains.length} existing CUSTOM domain(s)${dryRun ? " (dry run)" : ""}`);

  for (const { domain, templateId } of domains) {
    console.log(`- ${domain} (template ${templateId})`);
    if (dryRun) continue;
    try {
      const { routingEndpoint } = await addCloudFrontDomain(domain);
      console.log(`  tenant ready, routing endpoint: ${routingEndpoint}`);
    } catch (err) {
      console.error(`  FAILED for ${domain}:`, err);
    }
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
