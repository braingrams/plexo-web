import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import { auth } from "@/server/auth";
import { resolveManageLandingPagePublishing } from "@/lib/subscription";
import { getPagesDomain } from "@/server/pagesDomain";
import { scanPublishedDomain } from "@/lib/safeBrowsing";

const SUBDOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const DOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

const RESERVED_SUBDOMAINS = new Set([
  "admin", "api", "auth", "dashboard", "plexobuilder", "www", "localhost", "dev",
  "test", "prod", "staging", "status", "dns", "mail", "email", "support", "help",
  "static", "assets", "sdk", "pub", "published", "templates", "compile", "settings",
  "profile", "domains", "account", "login", "register", "signup", "logout", "signin"
]);

async function addVercelDomain(domain: string) {
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

async function removeVercelDomain(domain: string) {
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
      return {
        userId: user.id,
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
      userId: resolved.userId,
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

  // Validate template exists and belongs to the user
  const template = await prisma.template.findFirst({
    where: { id: templateId, userId: resolved.userId },
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
    // 1. If it's already linked to the exact same template and user, it is an idempotent success
    if (existingDomain.templateId === templateId && existingDomain.userId === resolved.userId) {
      return NextResponse.json({ success: true, domain: existingDomain });
    }

    // 2. If it is an explicit re-link update request on the user's own domain
    if (body.relink && existingDomain.userId === resolved.userId) {
      const updated = await prisma.publishedDomain.update({
        where: { id: existingDomain.id },
        data: { templateId },
      });
      // Content changed under this domain — re-scan rather than trust the last result.
      void scanPublishedDomain(updated.id).catch((err) => console.error("Safe Browsing scan failed:", err));
      return NextResponse.json({ success: true, domain: updated });
    }

    // 3. Otherwise, block the request as a duplicate mapping attempt
    if (existingDomain.userId === resolved.userId) {
      return NextResponse.json({
        error: "This domain is already linked to another landing page in your account. Please unlink it or edit it from the Domain Management dashboard."
      }, { status: 409 });
    } else {
      return NextResponse.json({
        error: "This domain name is already registered by another account."
      }, { status: 409 });
    }
  }

  // Check user limits before creating new domain mapping
  const currentCount = await prisma.publishedDomain.count({
    where: { userId: resolved.userId },
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

  const { searchParams } = new URL(request.url);
  const domainId = searchParams.get("id")?.trim();
  const domainName = searchParams.get("domain")?.trim().toLowerCase();

  const record = await prisma.publishedDomain.findFirst({
    where: {
      OR: [
        { id: domainId || undefined },
        { domain: domainName || undefined },
      ],
      userId: resolved.userId,
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
