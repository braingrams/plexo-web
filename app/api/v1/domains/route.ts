import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import { auth } from "@/server/auth";
import { resolveManageLandingPagePublishing, getTierFeatures } from "@/lib/subscription";
import { getPagesDomain } from "@/server/pagesDomain";
import { scanPublishedDomain } from "@/lib/safeBrowsing";
import { requirePermission } from "@/server/requirePermission";

const SUBDOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const DOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

const RESERVED_SUBDOMAINS = new Set([
  "admin", "api", "auth", "dashboard", "plexobuilder", "www", "localhost", "dev",
  "test", "prod", "staging", "status", "dns", "mail", "email", "support", "help",
  "static", "assets", "sdk", "pub", "published", "templates", "compile", "settings",
  "profile", "domains", "account", "login", "register", "signup", "logout", "signin"
]);

export async function addVercelDomain(domain: string) {
  const token = process.env.VERCEL_AUTH_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  const teamId = process.env.VERCEL_TEAM_ID;

  if (!token || !projectId) {
    console.warn("Vercel configurations missing. Skipping Vercel Domain registration in local development.");
    return;
  }

  const url = `https://api.vercel.com/v10/projects/${projectId}/domains${teamId ? `?teamId=${teamId}` : ""}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: domain }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    console.error("Failed to add domain to Vercel project:", data.error);
    throw new Error(data.error?.message ?? "Failed to configure custom domain routing on the server.");
  }
}

export async function removeVercelDomain(domain: string) {
  const token = process.env.VERCEL_AUTH_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  const teamId = process.env.VERCEL_TEAM_ID;

  if (!token || !projectId) {
    return;
  }

  const url = `https://api.vercel.com/v9/projects/${projectId}/domains/${domain}${teamId ? `?teamId=${teamId}` : ""}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: {
      "Authorization": `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    console.error("Failed to remove domain from Vercel project:", data.error);
  }
}

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

export async function GET(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const baseDomain = getPagesDomain();

  const { searchParams } = new URL(request.url);
  const templateId = searchParams.get("templateId");

  const domains = await prisma.publishedDomain.findMany({
    where: {
      organizationId: resolved.organizationId,
      templateId: templateId || undefined,
    },
    include: {
      template: {
        select: {
          name: true,
          kind: true,
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  const count = await prisma.publishedDomain.count({
    where: { userId: resolved.userId },
  });

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
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const permissionError = await requirePermission(request.headers, resolved.role, { domain: ["manage"] });
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
  const template = await prisma.template.findFirst({
    where: { id: templateId, organizationId: resolved.organizationId },
  });

  if (!template) {
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

  // Check if domain is already registered
  const existingDomain = await prisma.publishedDomain.findUnique({
    where: { domain: finalDomain },
  });

  if (existingDomain) {
    // 1. If it's already linked to the exact same template and org, it is an idempotent success
    if (existingDomain.templateId === templateId && existingDomain.organizationId === resolved.organizationId) {
      return NextResponse.json({ success: true, domain: existingDomain });
    }

    // 2. If it is an explicit re-link update request on the org's own domain
    if (body.relink && existingDomain.organizationId === resolved.organizationId) {
      const updated = await prisma.publishedDomain.update({
        where: { id: existingDomain.id },
        data: { templateId },
      });
      // Content changed under this domain — re-scan rather than trust the last result.
      void scanPublishedDomain(updated.id).catch((err) => console.error("Safe Browsing scan failed:", err));
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
  const currentCount = await prisma.publishedDomain.count({
    where: { organizationId: resolved.organizationId },
  });

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

  const created = await prisma.publishedDomain.create({
    data: {
      userId: resolved.userId,
      organizationId: resolved.organizationId,
      templateId,
      domain: finalDomain,
      type,
    },
  });

  // Fire-and-forget abuse scan — never blocks the publish response on an external API call.
  void scanPublishedDomain(created.id).catch((err) => console.error("Safe Browsing scan failed:", err));

  return NextResponse.json({ success: true, domain: created });
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const permissionError = await requirePermission(request.headers, resolved.role, { domain: ["manage"] });
  if (permissionError) return permissionError;

  const { searchParams } = new URL(request.url);
  const domainId = searchParams.get("id")?.trim();
  const domainName = searchParams.get("domain")?.trim().toLowerCase();

  const record = await prisma.publishedDomain.findFirst({
    where: {
      OR: [
        { id: domainId || undefined },
        { domain: domainName || undefined },
      ],
      organizationId: resolved.organizationId,
    },
  });

  if (!record) {
    return NextResponse.json({ error: "Published domain not found or unauthorized." }, { status: 404 });
  }

  if (record.type === "CUSTOM") {
    await removeVercelDomain(record.domain);
  }

  await prisma.publishedDomain.delete({
    where: { id: record.id },
  });

  return NextResponse.json({ success: true });
}
