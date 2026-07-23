import { NextRequest, NextResponse } from "next/server";
import { TemplateKind } from "@prisma/client";
import { prisma } from "@/server/prisma";
import { compileToHTML } from "@/lib/compiler";
import { getTierFeatures } from "@/lib/subscription";
import { getDomainLimit, resolveUser } from "../domains/route";

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
    console.warn("Vercel configurations missing. Skipping Vercel domain registration in local dev mode.");
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
    throw new Error(data.error?.message ?? "Failed to configure custom domain routing.");
  }
}

/**
 * POST /api/v1/publish
 *
 * Single atomic endpoint for AI tools (MCP server, ChatGPT Custom Actions, Agents)
 * to save a landing page design AND publish it to a domain in 1 step.
 *
 * Payload:
 * {
 *   "name": "Acme SaaS Landing Page",
 *   "designJson": { ... },
 *   "compiledHtml": "<html>...</html>" (optional, auto-compiled from designJson if omitted),
 *   "domain": "acme-saas",
 *   "type": "SUBDOMAIN" | "CUSTOM" (optional, inferred if omitted)
 * }
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized. Valid API Key or Session required." }, { status: 401 });
  }

  const features = getTierFeatures(resolved.subscriptionPlan);
  if (!features.landingPagesEnabled) {
    return NextResponse.json(
      { error: "Landing page creation requires a PRO or ULTRA subscription plan." },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const name = body.name?.trim() || "AI Generated Landing Page";
  const designJson = body.designJson;
  let rawDomain = body.domain?.trim().toLowerCase() || "";
  let domainType = body.type as "SUBDOMAIN" | "CUSTOM" | undefined;

  if (!designJson || typeof designJson !== "object") {
    return NextResponse.json(
      { error: "Missing required 'designJson' object representing page layout." },
      { status: 400 }
    );
  }

  // Auto-compile HTML if compiledHtml is not provided
  let compiledHtml = body.compiledHtml;
  if (!compiledHtml || typeof compiledHtml !== "string" || !compiledHtml.trim()) {
    try {
      if (designJson && typeof designJson === "object") {
        if ((designJson as any).body && (designJson as any).body.style) {
          (designJson as any).body.style.htmlTitle = (designJson as any).body.style.htmlTitle || name;
        } else if ((designJson as any).style) {
          (designJson as any).style.htmlTitle = (designJson as any).style.htmlTitle || name;
        }
      }
      compiledHtml = compileToHTML(designJson as any);
    } catch (err) {
      return NextResponse.json(
        { error: `Failed to compile designJson into HTML: ${err instanceof Error ? err.message : "Malformed structure"}` },
        { status: 400 }
      );
    }
  }

  // Check template creation limits
  if (features.maxTemplates !== -1) {
    const templateCount = await prisma.template.count({ where: { userId: resolved.userId } });
    if (templateCount >= features.maxTemplates) {
      return NextResponse.json(
        { error: `Template limit reached (${features.maxTemplates}). Upgrade plan to create more pages.` },
        { status: 403 }
      );
    }
  }

  // 1. Create the Landing Page Template
  const template = await prisma.template.create({
    data: {
      userId: resolved.userId,
      name,
      kind: TemplateKind.LANDING_PAGE,
      designJson,
      compiledHtml,
    },
  });

  const baseAppUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const baseDomain = new URL(baseAppUrl).hostname;
  const editableUrl = `${baseAppUrl}/dashboard/templates/${template.id}`;

  // If no domain was provided, return the saved template details and dashboard URL
  if (!rawDomain) {
    return NextResponse.json({
      success: true,
      templateId: template.id,
      name: template.name,
      editableUrl,
      publishedUrl: null,
      message: "Landing page saved successfully. Pass a domain parameter to publish it live.",
    });
  }

  // Infer domain type if not specified
  if (!domainType) {
    domainType = rawDomain.includes(".") ? "CUSTOM" : "SUBDOMAIN";
  }

  let finalDomain = rawDomain;
  if (domainType === "SUBDOMAIN") {
    if (!SUBDOMAIN_REGEX.test(rawDomain)) {
      return NextResponse.json({
        error: "Subdomain slug must be lowercase alphanumeric characters or hyphens."
      }, { status: 400 });
    }
    if (RESERVED_SUBDOMAINS.has(rawDomain)) {
      return NextResponse.json({ error: `Subdomain '${rawDomain}' is reserved.` }, { status: 400 });
    }
    finalDomain = `${rawDomain}.${baseDomain}`;
  } else {
    if (!DOMAIN_REGEX.test(rawDomain)) {
      return NextResponse.json({ error: "Invalid custom domain format." }, { status: 400 });
    }
    if (rawDomain.endsWith("." + baseDomain) || rawDomain === baseDomain) {
      return NextResponse.json({ error: "Custom domains cannot end with platform base domain." }, { status: 400 });
    }
  }

  // Check domain limits
  const currentDomainCount = await prisma.publishedDomain.count({ where: { userId: resolved.userId } });
  const domainLimit = getDomainLimit(resolved.subscriptionPlan, resolved.customDomainLimit);
  if (currentDomainCount >= domainLimit) {
    return NextResponse.json({
      error: `Published domain limit reached (${domainLimit}). Unlink an existing domain to publish a new one.`
    }, { status: 403 });
  }

  // Check if domain is already registered
  const existingDomain = await prisma.publishedDomain.findUnique({
    where: { domain: finalDomain },
  });

  if (existingDomain) {
    if (existingDomain.userId === resolved.userId) {
      // Re-link to new template
      await prisma.publishedDomain.update({
        where: { id: existingDomain.id },
        data: { templateId: template.id },
      });
    } else {
      return NextResponse.json({ error: `Domain '${finalDomain}' is already registered by another account.` }, { status: 409 });
    }
  } else {
    if (domainType === "CUSTOM") {
      try {
        await addVercelDomain(finalDomain);
      } catch (err) {
        return NextResponse.json({
          error: err instanceof Error ? err.message : "Failed to register custom domain routing."
        }, { status: 500 });
      }
    }

    await prisma.publishedDomain.create({
      data: {
        userId: resolved.userId,
        templateId: template.id,
        domain: finalDomain,
        type: domainType,
      },
    });
  }

  const protocol = process.env.NODE_ENV === "development" ? "http" : "https";
  const publishedUrl = `${protocol}://${finalDomain}`;

  return NextResponse.json({
    success: true,
    templateId: template.id,
    name: template.name,
    domain: finalDomain,
    publishedUrl,
    editableUrl,
  });
}
