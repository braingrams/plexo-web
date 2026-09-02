import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import { auth } from "@/server/auth";
import { resolveManageLandingPagePublishing, getTierFeatures } from "@/lib/subscription";
import { getPagesDomain } from "@/server/pagesDomain";
import { scanPublishedDomain } from "@/lib/safeBrowsing";
import { requirePermission } from "@/server/requirePermission";
// Re-exported for existing callers that still import these from this route file —
// the real implementation moved to lib/vercelDomains.ts (see that file's own comment).
import { addVercelDomain, removeVercelDomain } from "@/lib/vercelDomains";
export { addVercelDomain, removeVercelDomain };

const SUBDOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const DOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

const RESERVED_SUBDOMAINS = new Set([
  "admin", "api", "auth", "dashboard", "plexobuilder", "www", "localhost", "dev",
  "test", "prod", "staging", "status", "dns", "mail", "email", "support", "help",
  "static", "assets", "sdk", "pub", "published", "templates", "compile", "settings",
  "profile", "domains", "account", "login", "register", "signup", "logout", "signin"
]);

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function parseBearerToken(authorization: string | null): string | null {
  if (!authorization) return null;
  const [scheme, token] = authorization.split(" ");
  if (!scheme || !token) return null;
  if (scheme.toLowerCase() !== "bearer") return null;
  return token.trim() || null;
}

export async function resolveUser(
  request: NextRequest,
): Promise<{
  userId: string;
  // The org whose resources this request should read/write. Session-based callers get
  // whichever org is active on their session (see server/org.ts's ensureActiveOrganization);
  // API-key callers get the org that key belongs to (ApiKey.organizationId).
  organizationId: string;
  // Null for API-key auth: keys aren't tied to a human Member row/role, and have always
  // been allowed to act on their own account's resources — see server/requirePermission.ts,
  // which treats a null role as "skip the role check, this isn't a role-gated caller."
  role: string | null;
  subscriptionPlan: string;
  customDomainLimit: number | null;
  manageLandingPagePublishing: boolean;
} | null> {
  // 1. Try session-based auth first
  const session = await auth.api.getSession({ headers: request.headers });
  if (session?.user) {
    const user = await (prisma.user.findUnique as any)({
      where: { id: session.user.id },
      select: { id: true, subscriptionPlan: true, customDomainLimit: true, manageLandingPagePublishing: true },
    });
    if (user) {
      const activeOrgId = (session.session as { activeOrganizationId?: string }).activeOrganizationId;
      const membership =
        (activeOrgId &&
          (await prisma.member.findUnique({
            where: { organizationId_userId: { organizationId: activeOrgId, userId: user.id } },
          }))) ||
        (await prisma.member.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "asc" } }));

      // Every user should have a membership by the time they can reach a dashboard route
      // (see server/org.ts's ensureActiveOrganization, called from app/dashboard/layout.tsx),
      // but a caller hitting this API directly with only a session cookie and no
      // organization yet (e.g. right after signup, before the dashboard layout has run)
      // has nothing to scope to.
      if (!membership) return null;

      return {
        userId: user.id,
        organizationId: membership.organizationId,
        role: membership.role,
        subscriptionPlan: user.subscriptionPlan,
        customDomainLimit: user.customDomainLimit,
        manageLandingPagePublishing: resolveManageLandingPagePublishing(user.subscriptionPlan, user.manageLandingPagePublishing),
      };
    }
  }

  // 2. Try x-api-key header
  let rawKey = request.headers.get("x-api-key")?.trim() || null;
  if (!rawKey) {
    // 3. Try Bearer token
    rawKey = parseBearerToken(request.headers.get("authorization"));
  }

  if (rawKey === "workspace-internal") {
    return null;
  }

  if (!rawKey) return null;

  const hashedKey = sha256(rawKey);
  const apiKey = await prisma.apiKey.findFirst({
    where: {
      OR: [
        { hashedKey },
        { maskedKey: rawKey },
      ],
      isActive: true,
    },
    select: {
      userId: true,
      organizationId: true,
    },
  });

  if (!apiKey) return null;

  const user = await (prisma.user.findUnique as any)({
    where: { id: apiKey.userId },
    select: { subscriptionPlan: true, customDomainLimit: true, manageLandingPagePublishing: true },
  });

  if (!user) return null;
  return {
    userId: apiKey.userId,
    organizationId: apiKey.organizationId,
    role: null,
    subscriptionPlan: user.subscriptionPlan,
    customDomainLimit: user.customDomainLimit,
    manageLandingPagePublishing: resolveManageLandingPagePublishing(user.subscriptionPlan, user.manageLandingPagePublishing),
  };
}

export { getDomainLimit } from "@/lib/domainLimit";
import { getDomainLimit } from "@/lib/domainLimit";

// GET/POST/DELETE below are cut over to DynamoDB — resolveUser above (still Prisma-backed)
// stays for the 30+ other callers not yet ported; these three use the DynamoDB one instead.
import { resolveUser as resolveUserDynamo } from "@/lib/auth/resolveUser";
import { requirePermission as requirePermissionDynamo } from "@/server/requirePermissionDynamo";
import { Template, PublishedDomain } from "@/lib/db/contentEntities";
import type { EntityItem } from "electrodb";

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
  const { data: orgTemplates } = await Template.query.byOrg({ organizationId: resolved.organizationId }).go();
  const templateById = new Map(orgTemplates.map((t) => [t.id, t]));
  const templateIds = templateIdFilter ? [templateIdFilter] : orgTemplates.filter((t) => !t.parentId).map((t) => t.id);
  const domainBatches = await Promise.all(templateIds.map((id) => PublishedDomain.query.primary({ templateId: id }).go()));
  const domains = domainBatches
    .flatMap((b) => b.data)
    .filter((d) => templateById.has(d.templateId))
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
    .map((d) => ({ ...d, template: { name: templateById.get(d.templateId)?.name ?? "", kind: templateById.get(d.templateId)?.kind ?? "LANDING_PAGE" } }));

  const count = domains.filter((d) => d.userId === resolved.userId).length;

  // -1 = unlimited (self-managed publishing, Ultra-gated — see resolveManageLandingPagePublishing)
  const limit = resolved.manageLandingPagePublishing
    ? -1
    : getDomainLimit(resolved.subscriptionPlan, resolved.customDomainLimit);

  return NextResponse.json({
    domains,
    count,
    limit,
    plan: resolved.subscriptionPlan,
    baseDomain,
    manageLandingPagePublishing: resolved.manageLandingPagePublishing,
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
  const { data: orgTemplatesForCount } = await Template.query.byOrg({ organizationId: resolved.organizationId }).go();
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

  if (type === "CUSTOM") {
    if (!getTierFeatures(resolved.subscriptionPlan).customDomainEnabled) {
      return NextResponse.json({
        error: "Custom domains require a Pro or Ultra plan. Upgrade in Settings → Billing."
      }, { status: 403 });
    }
    try {
      await addVercelDomain(finalDomain);
    } catch (err) {
      return NextResponse.json({
        error: err instanceof Error ? err.message : "Failed to register custom domain routing on the server."
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
  }).go();
  const { data: created } = await PublishedDomain.get({ templateId, id: newId }).go();
  if (!created) throw new Error(`PublishedDomain ${newId} vanished immediately after being created`);

  // Fire-and-forget abuse scan — never blocks the publish response on an external API call.
  void scanPublishedDomain(created.templateId, created.id).catch((err) => console.error("Safe Browsing scan failed:", err));

  return NextResponse.json({ success: true, domain: created });
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
    const { data: orgTemplates } = await Template.query.byOrg({ organizationId: resolved.organizationId }).go();
    const batches = await Promise.all(
      orgTemplates.filter((t) => !t.parentId).map((t) => PublishedDomain.query.primary({ templateId: t.id }).go()),
    );
    record = batches.flatMap((b) => b.data).find((d) => d.id === domainId) ?? null;
  }

  if (!record || record.organizationId !== resolved.organizationId) {
    return NextResponse.json({ error: "Published domain not found or unauthorized." }, { status: 404 });
  }

  if (record.type === "CUSTOM") {
    await removeVercelDomain(record.domain);
  }

  await PublishedDomain.remove({ templateId: record.templateId, id: record.id }).go();

  return NextResponse.json({ success: true });
}
