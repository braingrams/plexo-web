import { NextRequest, NextResponse } from "next/server";
import { getTierFeatures } from "@/lib/subscription";
import { getPagesDomain } from "@/server/pagesDomain";
import { scanPublishedDomain } from "@/lib/safeBrowsing";
import { requestCustomDomainConnection, removeCloudFrontDomain, getRoutingEndpoint } from "@/lib/cloudfrontDomains";
import { getDomainLimit } from "@/lib/domainLimit";
import { resolveUser as resolveUserDynamo } from "@/lib/auth/resolveUser";
import { requirePermission as requirePermissionDynamo } from "@/server/requirePermissionDynamo";
import { Template, PublishedDomain } from "@/lib/db/contentEntities";
import type { EntityItem } from "electrodb";

const SUBDOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const DOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

const RESERVED_SUBDOMAINS = new Set([
  "admin", "api", "auth", "dashboard", "plexobuilder", "www", "localhost", "dev",
  "test", "prod", "staging", "status", "dns", "mail", "email", "support", "help",
  "static", "assets", "sdk", "pub", "published", "templates", "compile", "settings",
  "profile", "domains", "account", "login", "register", "signup", "logout", "signin"
]);

export async function GET(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUserDynamo(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const baseDomain = getPagesDomain();

  const { searchParams } = new URL(request.url);
  const templateIdFilter = searchParams.get("templateId");

  // PublishedDomain has no org-wide index (only templateId-primary and byDomain-GSI1) —
  // fans out per org template, same bound as the dashboard domains page's identical query.
  const { data: orgTemplates } = await Template.query.byOrg({ organizationId: resolved.organizationId }).go({ pages: "all" });
  const templateById = new Map(orgTemplates.map((t) => [t.id, t]));
  const templateIds = templateIdFilter ? [templateIdFilter] : orgTemplates.filter((t) => !t.parentId).map((t) => t.id);
  const domainBatches = await Promise.all(templateIds.map((id) => PublishedDomain.query.primary({ templateId: id }).go()));
  const domains = domainBatches
    .flatMap((b) => b.data)
    .filter((d) => templateById.has(d.templateId))
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
    .map((d) => ({ ...d, template: { name: templateById.get(d.templateId)?.name ?? "", kind: templateById.get(d.templateId)?.kind ?? "LANDING_PAGE" } }));

  const count = domains.filter((d) => d.userId === resolved.userId).length;

  // No live CloudFront/ACM calls here on purpose — each domain's own certificateStatus/
  // certificateValidationName/certificateValidationValue fields (already included via the
  // `...d` spread above) are kept current by lib/lambda/certificateAttachment.ts's
  // scheduled check, not by page views. An earlier version of this route DID mutate
  // CloudFront state on every page load as a retry mechanism — real, hard-won lesson: that
  // repeatedly restarted certificate validation from scratch every time someone reloaded
  // the page, which is why a customer domain kept issuing a fresh certificate every few
  // minutes and never actually finished attaching. Reads and writes are fully separated now.

  // -1 = unlimited (self-managed publishing, Ultra-gated — see resolveManageLandingPagePublishing)
  const limit = resolved.manageLandingPagePublishing
    ? -1
    : getDomainLimit(resolved.subscriptionPlan, resolved.customDomainLimit);

  // A single environment-wide value (same connection group serves every tenant here) —
  // safe to omit rather than 500 the whole domains list if it's genuinely unset (e.g. a
  // fresh environment where published-sites-stack.ts hasn't been deployed yet).
  let routingEndpoint: string | undefined;
  try {
    routingEndpoint = getRoutingEndpoint();
  } catch {
    routingEndpoint = undefined;
  }

  return NextResponse.json({
    domains,
    count,
    limit,
    plan: resolved.subscriptionPlan,
    baseDomain,
    manageLandingPagePublishing: resolved.manageLandingPagePublishing,
    routingEndpoint,
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUserDynamo(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const permissionError = requirePermissionDynamo(resolved.role, { domain: ["manage"] });
  if (permissionError) return permissionError;

  const body = await request.json().catch(() => ({}));
  const { templateId, type } = body;
  let rawDomain = body.domain?.trim().toLowerCase() || "";

  if (!templateId || !type || !rawDomain) {
    return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
  }

  if (type !== "SUBDOMAIN" && type !== "CUSTOM") {
    return NextResponse.json({ error: "Invalid domain type." }, { status: 400 });
  }

  const baseDomain = getPagesDomain();

  // Validate template exists and belongs to the organization
  const { data: template } = await Template.get({ id: templateId }).go();

  if (!template || template.organizationId !== resolved.organizationId) {
    return NextResponse.json({ error: "Template not found or unauthorized." }, { status: 404 });
  }

  let finalDomain = rawDomain;

  if (type === "SUBDOMAIN") {
    if (!SUBDOMAIN_REGEX.test(rawDomain)) {
      return NextResponse.json({
        error: "Subdomain prefix must be lowercase alphanumeric characters or hyphens only, and cannot start/end with a hyphen."
      }, { status: 400 });
    }
    if (RESERVED_SUBDOMAINS.has(rawDomain)) {
      return NextResponse.json({ error: "This subdomain name is reserved." }, { status: 400 });
    }
    finalDomain = `${rawDomain}.${baseDomain}`;
  } else {
    // Custom domain
    if (!DOMAIN_REGEX.test(rawDomain)) {
      return NextResponse.json({ error: "Invalid custom domain format." }, { status: 400 });
    }
    if (rawDomain.endsWith("." + baseDomain) || rawDomain === baseDomain) {
      return NextResponse.json({ error: "Custom domains cannot end with the platform base domain." }, { status: 400 });
    }
  }

  // Check if domain is already registered — THE hot-path lookup (byDomain GSI1).
  const { data: existingMatches } = await PublishedDomain.query.byDomain({ domain: finalDomain }).go();
  const existingDomain = existingMatches[0] ?? null;

  if (existingDomain) {
    // 1. If it's already linked to the exact same template and org, it is an idempotent success
    if (existingDomain.templateId === templateId && existingDomain.organizationId === resolved.organizationId) {
      return NextResponse.json({ success: true, domain: existingDomain });
    }

    // 2. If it is an explicit re-link update request on the org's own domain
    if (body.relink && existingDomain.organizationId === resolved.organizationId) {
      // templateId is part of this entity's own primary key (see contentEntities.ts) —
      // a real re-link (pointing at a different template) moves the item to a new key
      // via create-at-new-key + remove-old-key, same pattern used for a BlogPost slug
      // rename; ElectroDB can't .set() a key-composite attribute in place.
      let updated = existingDomain;
      if (existingDomain.templateId !== templateId) {
        await PublishedDomain.create({ ...existingDomain, templateId }).go();
        await PublishedDomain.remove({ templateId: existingDomain.templateId, id: existingDomain.id }).go();
        const { data: moved } = await PublishedDomain.get({ templateId, id: existingDomain.id }).go();
        if (moved) updated = moved;
      }
      // Content changed under this domain — re-scan rather than trust the last result.
      void scanPublishedDomain(updated.templateId, updated.id).catch((err) => console.error("Safe Browsing scan failed:", err));
      return NextResponse.json({ success: true, domain: updated });
    }

    // 3. Otherwise, block the request as a duplicate mapping attempt
    if (existingDomain.organizationId === resolved.organizationId) {
      return NextResponse.json({
        error: "This domain is already linked to another landing page in your account. Please unlink it or edit it from the Domain Management dashboard."
      }, { status: 409 });
    } else {
      return NextResponse.json({
        error: "This domain name is already registered by another account."
      }, { status: 409 });
    }
  }

  // Check org limits before creating new domain mapping
  const { data: orgTemplatesForCount } = await Template.query.byOrg({ organizationId: resolved.organizationId }).go({ pages: "all" });
  const rootIds = orgTemplatesForCount.filter((t) => !t.parentId).map((t) => t.id);
  const domainCountBatches = await Promise.all(rootIds.map((id) => PublishedDomain.query.primary({ templateId: id }).go()));
  const currentCount = domainCountBatches.reduce((sum, b) => sum + b.data.length, 0);

  const limit = resolved.manageLandingPagePublishing
    ? -1
    : getDomainLimit(resolved.subscriptionPlan, resolved.customDomainLimit);

  if (limit !== -1 && currentCount >= limit) {
    return NextResponse.json({
      error: `You have reached your limit of ${limit} published domains. Please delete an existing domain to publish a new one.`
    }, { status: 403 });
  }

  let routingEndpoint: string | undefined;
  let certificateArn: string | undefined;
  let certificateValidationName: string | undefined;
  let certificateValidationValue: string | undefined;
  if (type === "CUSTOM") {
    if (!getTierFeatures(resolved.subscriptionPlan).customDomainEnabled) {
      return NextResponse.json({
        error: "Custom domains require a Pro or Ultra plan. Upgrade in Settings → Billing."
      }, { status: 403 });
    }
    try {
      const result = await requestCustomDomainConnection(finalDomain);
      routingEndpoint = result.routingEndpoint;
      certificateArn = result.certificateArn;
      certificateValidationName = result.certificateValidationName;
      certificateValidationValue = result.certificateValidationValue;
    } catch (err) {
      return NextResponse.json({
        error: err instanceof Error ? err.message : "Failed to request a certificate for this domain."
      }, { status: 500 });
    }
  }

  const newId = crypto.randomUUID();
  await PublishedDomain.create({
    id: newId,
    userId: resolved.userId,
    organizationId: resolved.organizationId,
    templateId,
    domain: finalDomain,
    type,
    ...(type === "CUSTOM" ? { certificateArn, certificateStatus: "PENDING_VALIDATION" as const, certificateValidationName, certificateValidationValue } : {}),
  }).go();
  const { data: created } = await PublishedDomain.get({ templateId, id: newId }).go();
  if (!created) throw new Error(`PublishedDomain ${newId} vanished immediately after being created`);

  // Fire-and-forget abuse scan — never blocks the publish response on an external API call.
  void scanPublishedDomain(created.templateId, created.id).catch((err) => console.error("Safe Browsing scan failed:", err));

  // routingEndpoint (CUSTOM domains only) is dynamic per environment — CloudFront SaaS
  // Manager's connection-group endpoint, unlike Vercel's old fixed "cname.vercel-dns.com"
  // — the dashboard needs it in the response to show the right CNAME target, not a
  // hardcoded frontend constant. See app/dashboard/domains/domains-client.tsx. A CUSTOM
  // domain never activates synchronously anymore — lib/lambda/certificateAttachment.ts's
  // scheduled check finishes connecting it automatically once the certificate validation
  // record propagates and ACM issues the certificate; no manual re-submission needed.
  return NextResponse.json({ success: true, domain: created, routingEndpoint });
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUserDynamo(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const permissionError = requirePermissionDynamo(resolved.role, { domain: ["manage"] });
  if (permissionError) return permissionError;

  const { searchParams } = new URL(request.url);
  const domainId = searchParams.get("id")?.trim();
  const domainName = searchParams.get("domain")?.trim().toLowerCase();

  let record: EntityItem<typeof PublishedDomain> | null = null;
  if (domainName) {
    const { data: matches } = await PublishedDomain.query.byDomain({ domain: domainName }).go();
    record = matches[0] ?? null;
  } else if (domainId) {
    // No id-only index — fan out across the org's templates to find it, same pattern
    // used throughout this migration for entities whose real key isn't the id field
    // callers pass around.
    const { data: orgTemplates } = await Template.query.byOrg({ organizationId: resolved.organizationId }).go({ pages: "all" });
    const batches = await Promise.all(
      orgTemplates.filter((t) => !t.parentId).map((t) => PublishedDomain.query.primary({ templateId: t.id }).go()),
    );
    record = batches.flatMap((b) => b.data).find((d) => d.id === domainId) ?? null;
  }

  if (!record || record.organizationId !== resolved.organizationId) {
    return NextResponse.json({ error: "Published domain not found or unauthorized." }, { status: 404 });
  }

  if (record.type === "CUSTOM") {
    await removeCloudFrontDomain(record.domain, { tenantId: record.tenantId, certificateArn: record.certificateArn });
  }

  await PublishedDomain.remove({ templateId: record.templateId, id: record.id }).go();

  return NextResponse.json({ success: true });
}
