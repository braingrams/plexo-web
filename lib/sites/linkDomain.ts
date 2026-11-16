import { randomUUID } from "node:crypto";
import { countLiveCustomDomains, customDomainError } from "@/lib/plan/domainGate";
import { Template, PublishedDomain } from "@/lib/db/contentEntities";
import { getDomainLimit } from "@/lib/domainLimit";
import { requestCustomDomainConnection } from "@/lib/cloudfrontDomains";
import { getPagesDomain } from "@/server/pagesDomain";
import { assertCanPutSiteLive } from "@/lib/plan/publishGuard";

// Connecting a domain (a *.pages subdomain or a custom domain) to a site. Shared by the MCP
// tools (lib/mcp/dispatchMcpTool.ts) and app publishing (lib/projects/pipeline.ts) — its
// own module so neither has to import the other.

export const SUBDOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
export const DOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export const RESERVED_SUBDOMAINS = new Set([
  "admin", "api", "auth", "dashboard", "plexobuilder", "www", "localhost", "dev",
  "test", "prod", "staging", "status", "dns", "mail", "email", "support", "help",
  "static", "assets", "sdk", "pub", "published", "templates", "compile", "settings",
  "profile", "domains", "account", "login", "register", "signup", "logout", "signin"
]);

export async function linkDomainToTemplate(
  resolved: { userId: string; organizationId: string; subscriptionPlan: string; onTrial?: boolean; customDomainLimit: number | null },
  templateId: string,
  rawDomainInput: string,
  domainTypeInput?: "SUBDOMAIN" | "CUSTOM"
): Promise<{
  finalDomain: string;
  publishedUrl: string;
  routingEndpoint: string | undefined;
  certificateValidationName: string | undefined;
  certificateValidationValue: string | undefined;
}> {
  const rawDomain = rawDomainInput.trim().toLowerCase();
  if (!rawDomain) {
    throw new Error("A domain is required to publish.");
  }

  // Tenant subdomains live on the dedicated pages domain (server/pagesDomain.ts),
  // isolated from the dashboard's own cookie/session domain — not the app's own
  // hostname. This function previously derived baseDomain from NEXT_PUBLIC_APP_URL
  // directly, missing the plexopages.io migration entirely: every subdomain published
  // through MCP was still landing on the dashboard's own domain regardless of that fix.
  const pagesDomain = getPagesDomain();

  let domainType = domainTypeInput;
  if (!domainType) {
    domainType = rawDomain.includes(".") ? "CUSTOM" : "SUBDOMAIN";
  }

  let finalDomain = rawDomain;
  if (domainType === "SUBDOMAIN") {
    if (!SUBDOMAIN_REGEX.test(rawDomain)) {
      throw new Error("Subdomain slug must be lowercase alphanumeric characters or hyphens.");
    }
    if (RESERVED_SUBDOMAINS.has(rawDomain)) {
      throw new Error(`Subdomain '${rawDomain}' is reserved.`);
    }
    // "--" is reserved for Plexo's own preview hosts ("preview--<id>", lib/projects/
    // previewHost.ts) so a published site can never take over another app's preview link.
    if (rawDomain.includes("--")) {
      throw new Error("Subdomains can't contain two hyphens in a row (--). Try a single hyphen instead.");
    }
    finalDomain = `${rawDomain}.${pagesDomain}`;
  } else {
    if (!DOMAIN_REGEX.test(rawDomain)) {
      throw new Error("Invalid custom domain format.");
    }
    if (rawDomain.endsWith("." + pagesDomain) || rawDomain === pagesDomain) {
      throw new Error("Custom domains cannot end with the platform pages domain.");
    }
  }

  // PublishedDomain has no org-wide index (only templateId-primary and byDomain-GSI1,
  // see contentEntities.ts) — fan out per org root template, same bound every other
  // ported org-wide domain count uses (app/api/v1/domains/route.ts, publish/route.ts).
  // Plan first: Free can't use a custom domain, and keeps one site live at a time.
  await assertCanPutSiteLive(resolved, templateId, domainType);

  const { data: orgTemplates } = await Template.query.byOrg({ organizationId: resolved.organizationId }).go({ pages: "all", attributes: ["id", "parentId"] });
  const rootIds = orgTemplates.filter((t) => !t.parentId).map((t) => t.id);
  const domainCountBatches = await Promise.all(rootIds.map((id) => PublishedDomain.query.primary({ templateId: id }).go({ pages: "all" })));
  // Addresses a downgrade switched off are kept (so an upgrade brings them back) but don't
  // use up the limit — otherwise a downgraded account couldn't publish anything at all.
  const currentDomainCount = domainCountBatches.reduce((sum, b) => sum + b.data.filter((d) => !d.planDisabledAt).length, 0);
  const domainLimit = getDomainLimit(resolved.subscriptionPlan, resolved.customDomainLimit);
  if (currentDomainCount >= domainLimit) {
    throw new Error(`Published domain limit reached (${domainLimit}). Unlink an existing domain to publish a new one.`);
  }
  if (domainType === "CUSTOM") {
    const customError = customDomainError(resolved, countLiveCustomDomains(domainCountBatches.flatMap((b) => b.data).filter((d) => d.domain !== finalDomain)));
    if (customError) throw new Error(customError);
  }

  const { data: domainMatches } = await PublishedDomain.query.byDomain({ domain: finalDomain }).go({ pages: "all" });
  const existingDomain = domainMatches[0] ?? null;
  if (existingDomain) {
    if (existingDomain.organizationId !== resolved.organizationId) {
      throw new Error(`Domain '${finalDomain}' is already registered by another account.`);
    }
    // templateId is part of this entity's own primary key (see contentEntities.ts) —
    // ElectroDB can't .set() a key-composite attribute in place, so a real re-link moves
    // the item via create-at-new-key + remove-old-key, same pattern used everywhere else
    // this migration has hit the same constraint (BlogPost slug rename, this same
    // re-link in app/api/v1/domains/route.ts and app/api/v1/publish/route.ts).
    if (existingDomain.templateId !== templateId) {
      await PublishedDomain.create({ ...existingDomain, templateId }).go();
      await PublishedDomain.remove({ templateId: existingDomain.templateId, id: existingDomain.id }).go();
    }
  } else {
    // A CUSTOM domain needs a real CloudFront distribution tenant (cdk/lib/published-
    // sites-stack.ts) before it has any valid routing or TLS cert — without this, the
    // database row alone would never actually work when visited. Connecting one is now a
    // two-phase, asynchronous process (see lib/cloudfrontDomains.ts's own comment): this
    // only requests the certificate and records what's needed to finish later;
    // lib/lambda/certificateAttachment.ts's scheduled check creates the actual
    // distribution tenant once ACM issues it.
    let cfRoutingEndpoint: string | undefined;
    let certificateArn: string | undefined;
    let certificateValidationName: string | undefined;
    let certificateValidationValue: string | undefined;
    if (domainType === "CUSTOM") {
      const result = await requestCustomDomainConnection(finalDomain);
      cfRoutingEndpoint = result.routingEndpoint;
      certificateArn = result.certificateArn;
      certificateValidationName = result.certificateValidationName;
      certificateValidationValue = result.certificateValidationValue;
    }
    await PublishedDomain.create({
      id: randomUUID(),
      userId: resolved.userId,
      organizationId: resolved.organizationId,
      templateId,
      domain: finalDomain,
      type: domainType,
      ...(domainType === "CUSTOM" ? { certificateArn, certificateStatus: "PENDING_VALIDATION" as const, certificateValidationName, certificateValidationValue } : {}),
    }).go();
    const protocol = process.env.NODE_ENV === "development" ? "http" : "https";
    return {
      finalDomain,
      publishedUrl: `${protocol}://${finalDomain}`,
      routingEndpoint: cfRoutingEndpoint,
      certificateValidationName,
      certificateValidationValue,
    };
  }

  const protocol = process.env.NODE_ENV === "development" ? "http" : "https";
  return { finalDomain, publishedUrl: `${protocol}://${finalDomain}`, routingEndpoint: undefined, certificateValidationName: undefined, certificateValidationValue: undefined };
}
