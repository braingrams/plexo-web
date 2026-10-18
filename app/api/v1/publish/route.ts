import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { Template, PublishedDomain } from "@/lib/db/contentEntities";
import { compileToHTML } from "@/lib/compiler";
import { TemplateJSONSchema, hydrateStructuralDefaults, formatValidationIssues, sanitizeHtml } from "@/server/sanitizer";
import { compileTemplate } from "@/lib/compileTemplate";
import { defaultDesignFormat, isV2Design, parseV2Design } from "@/lib/v2/design";
import { getTierFeatures } from "@/lib/subscription";
import { resolveUser } from "@/lib/auth/resolveUser";
import { getDomainLimit } from "@/lib/domainLimit";
import { getPagesDomain } from "@/server/pagesDomain";
import { scanPublishedDomain } from "@/lib/safeBrowsing";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { requestCustomDomainConnection } from "@/lib/cloudfrontDomains";
import { PlanLimitError, planLimitResponse } from "@/lib/plan/publishGuard";
import { otherLiveSites } from "@/lib/plan/siteLimits";
import { listGovernedSites } from "@/lib/plan/sitesStore";

const SUBDOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const DOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

const RESERVED_SUBDOMAINS = new Set([
  "admin", "api", "auth", "dashboard", "plexobuilder", "www", "localhost", "dev",
  "test", "prod", "staging", "status", "dns", "mail", "email", "support", "help",
  "static", "assets", "sdk", "pub", "published", "templates", "compile", "settings",
  "profile", "domains", "account", "login", "register", "signup", "logout", "signin"
]);

/**
 * POST /api/v1/publish
 *
 * Single atomic endpoint for AI tools (MCP server, ChatGPT Custom Actions, Agents)
 * to save a landing page or email template design, and (landing pages only) publish
 * it to a domain, in 1 step.
 *
 * Payload:
 * {
 *   "name": "Acme SaaS Landing Page",
 *   "kind": "LANDING_PAGE" | "EMAIL" (optional, defaults to "LANDING_PAGE"),
 *   "designJson": { "body": { "style": {...}, "rows": [{ "id", "style", "columns": [{ "id", "width", "elements": [...] }] }] } },
 *   "compiledHtml": ignored — always compiled server-side from designJson,
 *   "domain": "acme-saas" (LANDING_PAGE only — ignored for EMAIL, which has no domain),
 *   "type": "SUBDOMAIN" | "CUSTOM" (optional, inferred if omitted)
 * }
 *
 * designJson must already be the fully hydrated builder schema (every row has a 'columns'
 * array of columns with an 'elements' array) — validated against the same TemplateJSONSchema
 * the dashboard's own save endpoint uses (server/sanitizer.ts). Invalid/shorthand shapes are
 * rejected with a 400 describing exactly what's wrong, instead of being silently guessed at.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized. Valid API Key or Session required." }, { status: 401 });
  }

  const permissionError = requirePermission(resolved.role, { template: ["publish"] });
  if (permissionError) return permissionError;

  const body = await request.json().catch(() => ({}));
  const kind: "EMAIL" | "LANDING_PAGE" =
    typeof body.kind === "string" && body.kind.toUpperCase() === "EMAIL" ? "EMAIL" : "LANDING_PAGE";

  const features = getTierFeatures(resolved.subscriptionPlan);

  const name = body.name?.trim() || (kind === "EMAIL" ? "AI Generated Email Template" : "AI Generated Landing Page");
  const rawDesignJson = body.designJson;
  const rawDomain = kind === "EMAIL" ? "" : body.domain?.trim().toLowerCase() || "";
  let domainType = body.type as "SUBDOMAIN" | "CUSTOM" | undefined;

  if (!rawDesignJson || typeof rawDesignJson !== "object") {
    return NextResponse.json(
      { error: "Missing required 'designJson' object representing page layout." },
      { status: 400 }
    );
  }

  // The page's id is chosen up front: a new-editor page's forms post to its own site id.
  const templateId = randomUUID();

  // A new-editor (V2) payload creates a V2 page — only while new-editor creation is switched
  // on (TEMPLATES_V2_NEW) and only for landing pages (email stays classic forever).
  const payloadIsV2 = isV2Design(rawDesignJson);
  if (payloadIsV2 && (kind === "EMAIL" || defaultDesignFormat() !== "v2")) {
    return NextResponse.json(
      { error: kind === "EMAIL" ? "Email templates use the classic design format." : "The new page editor isn't switched on for your account yet. Send a classic design (body.rows) instead." },
      { status: 400 },
    );
  }

  let designJson: any;
  let compiledHtml: string;
  const designFormat: "v1" | "v2" = payloadIsV2 ? "v2" : "v1";
  if (payloadIsV2) {
    const parsed = parseV2Design(rawDesignJson);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    designJson = parsed.design;
    try {
      compiledHtml = await compileTemplate({ designFormat, designJson, kind, id: templateId, name });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "This page couldn't be built." }, { status: 400 });
    }
  } else {
    // Same strict schema the dashboard's own save endpoint enforces (server/sanitizer.ts) —
    // every row must already be a fully hydrated { columns: [{ elements: [...] }] } tree.
    // We reject rather than guess: a caller (MCP server, ChatGPT Custom Action, agent) gets
    // one clean, actionable error to retry against instead of a silently mangled page.
    const hydrated = hydrateStructuralDefaults(rawDesignJson);
    const validation = TemplateJSONSchema.safeParse(hydrated);
    if (!validation.success) {
      return NextResponse.json(
        { error: `designJson failed schema validation: ${formatValidationIssues(validation.error)}` },
        { status: 400 }
      );
    }
    designJson = validation.data;
    if (designJson.body.style) {
      designJson.body.style.htmlTitle = designJson.body.style.htmlTitle || name;
    }

    // compiledHtml is always derived server-side from the validated designJson (never trusted
    // from the caller) so the published page can never drift from what's editable in the
    // dashboard, and so a third-party AI client can't hand us raw HTML/script.
    try {
      compiledHtml = kind === "LANDING_PAGE"
        ? await compileTemplate({ designFormat, designJson, kind, id: templateId, name })
        : sanitizeHtml(compileToHTML(designJson)); // email templates: legacy path, unchanged
    } catch (err) {
      return NextResponse.json(
        { error: `Failed to compile designJson into HTML: ${err instanceof Error ? err.message : "Malformed structure"}` },
        { status: 400 }
      );
    }
  }

  // Plan check BEFORE anything is created, so a refused publish leaves nothing behind.
  // Free: Plexo addresses only, and one live site at a time (lib/plan/publishGuard.ts).
  if (kind === "LANDING_PAGE" && rawDomain) {
    const wantsCustom = (domainType ?? (rawDomain.includes(".") ? "CUSTOM" : "SUBDOMAIN")) === "CUSTOM";
    try {
      if (wantsCustom && !features.customDomainEnabled) {
        throw new PlanLimitError("PLAN_CUSTOM_DOMAIN_REQUIRES_UPGRADE", "Custom domains are part of Pro. Publish to a free Plexo address (a name without dots, e.g. \"acme\") or upgrade to use your own domain.");
      }
      if (features.maxPublishedSites !== null) {
        // The page is brand new, so every live site counts against the limit — except one
        // that already owns this exact address (re-pointing it replaces that site).
        const finalForCheck = wantsCustom ? rawDomain : `${rawDomain}.${getPagesDomain()}`;
        const live = otherLiveSites(await listGovernedSites(resolved.userId), "").filter((s) => !s.domains.some((d) => d.domain === finalForCheck));
        if (live.length >= features.maxPublishedSites) {
          throw new PlanLimitError(
            "PLAN_SITE_LIMIT_EXCEEDED",
            `The Free plan keeps one site live at a time, and "${live[0].name}" is live now. Upgrade to Pro to publish more sites, or call again without a domain to save this page as a draft.`,
            { liveSiteIds: live.map((s) => s.id), liveSiteNames: live.map((s) => s.name) },
          );
        }
      }
    } catch (err) {
      if (err instanceof PlanLimitError) return planLimitResponse(err);
      throw err;
    }
  }

  // Check template creation limits — root/home pages only, per kind, so a landing page
  // with several multipage sub-pages still counts as one against this limit, not several.
  {
    const limit = kind === "EMAIL" ? features.maxEmailTemplates : features.maxLandingPages;
    const { data: orgTemplates } = await Template.query.byOrg({ organizationId: resolved.organizationId }).go({ pages: "all" });
    const templateCount = orgTemplates.filter(
      (t) => !t.parentId && t.kind === kind && !t.isBlogLayout && !t.isSiteLayoutFragment && !t.isCommerceLayout,
    ).length;
    if (templateCount >= limit) {
      const label = kind === "EMAIL" ? "email templates" : "landing pages";
      return NextResponse.json(
        { error: `Template limit reached (${limit} ${label}). Upgrade plan to create more.` },
        { status: 403 }
      );
    }
  }

  // 1. Create the template
  await Template.create({
    id: templateId,
    designFormat,
    userId: resolved.userId,
    organizationId: resolved.organizationId,
    name,
    kind,
    designJson,
    compiledHtml,
  }).go();
  const { data: template } = await Template.get({ id: templateId }).go();
  if (!template) throw new Error(`Template ${templateId} vanished immediately after being created`);

  const baseAppUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const pagesDomain = getPagesDomain();
  const editableUrl = `${baseAppUrl}/dashboard/templates/${template.id}`;

  // Email templates don't publish to a domain — only landing pages do.
  if (kind === "EMAIL") {
    return NextResponse.json({
      success: true,
      templateId: template.id,
      name: template.name,
      editableUrl,
      publishedUrl: null,
      message: "Email template saved successfully.",
    });
  }

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
    // "--" is reserved for Plexo's own app preview hosts (lib/projects/previewHost.ts).
    if (rawDomain.includes("--")) {
      return NextResponse.json({ error: "Subdomains can't contain two hyphens in a row (--). Try a single hyphen instead." }, { status: 400 });
    }
    finalDomain = `${rawDomain}.${pagesDomain}`;
  } else {
    if (!DOMAIN_REGEX.test(rawDomain)) {
      return NextResponse.json({ error: "Invalid custom domain format." }, { status: 400 });
    }
    if (rawDomain.endsWith("." + pagesDomain) || rawDomain === pagesDomain) {
      return NextResponse.json({ error: "Custom domains cannot end with the platform pages domain." }, { status: 400 });
    }
  }

  // Check domain limits — PublishedDomain has no org-wide index (only templateId-primary
  // and byDomain-GSI1), fans out per org root template same as app/api/v1/domains/route.ts.
  const { data: orgTemplatesForCount } = await Template.query.byOrg({ organizationId: resolved.organizationId }).go({ pages: "all" });
  const rootIds = orgTemplatesForCount.filter((t) => !t.parentId).map((t) => t.id);
  const domainCountBatches = await Promise.all(rootIds.map((id) => PublishedDomain.query.primary({ templateId: id }).go()));
  const currentDomainCount = domainCountBatches.reduce((sum, b) => sum + b.data.filter((d) => !d.planDisabledAt).length, 0);
  const domainLimit = getDomainLimit(resolved.subscriptionPlan, resolved.customDomainLimit);
  if (currentDomainCount >= domainLimit) {
    return NextResponse.json({
      error: `Published domain limit reached (${domainLimit}). Unlink an existing domain to publish a new one.`
    }, { status: 403 });
  }

  // Check if domain is already registered — THE hot-path lookup (byDomain GSI1).
  const { data: existingMatches } = await PublishedDomain.query.byDomain({ domain: finalDomain }).go();
  const existingDomain = existingMatches[0] ?? null;

  if (existingDomain) {
    if (existingDomain.organizationId === resolved.organizationId) {
      // Re-link to new template. templateId is part of this entity's own primary key
      // (see contentEntities.ts) — ElectroDB can't .set() a key-composite attribute in
      // place, so a real re-link moves the item via create-at-new-key + remove-old-key,
      // same pattern used for a BlogPost slug rename.
      let updated = existingDomain;
      if (existingDomain.templateId !== template.id) {
        await PublishedDomain.create({ ...existingDomain, templateId: template.id }).go();
        await PublishedDomain.remove({ templateId: existingDomain.templateId, id: existingDomain.id }).go();
        const { data: moved } = await PublishedDomain.get({ templateId: template.id, id: existingDomain.id }).go();
        if (moved) updated = moved;
      }
      void scanPublishedDomain(updated.templateId, updated.id).catch((err) => console.error("Safe Browsing scan failed:", err));

      const protocol = process.env.NODE_ENV === "development" ? "http" : "https";
      return NextResponse.json({
        success: true,
        templateId: template.id,
        name: template.name,
        domain: finalDomain,
        publishedUrl: `${protocol}://${finalDomain}`,
        editableUrl,
      });
    } else {
      return NextResponse.json({ error: `Domain '${finalDomain}' is already registered by another account.` }, { status: 409 });
    }
  }

  let routingEndpoint: string | undefined;
  let certificateArn: string | undefined;
  let certificateValidationName: string | undefined;
  let certificateValidationValue: string | undefined;
  if (domainType === "CUSTOM") {
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

  const newDomainId = randomUUID();
  await PublishedDomain.create({
    id: newDomainId,
    userId: resolved.userId,
    organizationId: resolved.organizationId,
    templateId: template.id,
    domain: finalDomain,
    type: domainType,
    ...(domainType === "CUSTOM" ? { certificateArn, certificateStatus: "PENDING_VALIDATION" as const, certificateValidationName, certificateValidationValue } : {}),
  }).go();
  const { data: createdDomain } = await PublishedDomain.get({ templateId: template.id, id: newDomainId }).go();
  if (!createdDomain) throw new Error(`PublishedDomain ${newDomainId} vanished immediately after being created`);
  void scanPublishedDomain(createdDomain.templateId, createdDomain.id).catch((err) => console.error("Safe Browsing scan failed:", err));

  const protocol = process.env.NODE_ENV === "development" ? "http" : "https";
  const publishedUrl = `${protocol}://${finalDomain}`;

  return NextResponse.json({
    success: true,
    templateId: template.id,
    name: template.name,
    domain: finalDomain,
    publishedUrl,
    editableUrl,
    routingEndpoint,
  });
}
