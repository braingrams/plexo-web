import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { put, del } from "@vercel/blob";
import { prisma } from "@/server/prisma";
import { compileToHTML } from "@/lib/compiler";
import { TemplateJSONSchema, hydrateStructuralDefaults, formatValidationIssues, sanitizeHtml } from "@/server/sanitizer";
import { getTierFeatures } from "@/lib/subscription";
import { resolveUser, getDomainLimit, removeVercelDomain, addVercelDomain } from "@/app/api/v1/domains/route";
import { resolveStrataProjectId, fetchStrataTokens } from "@/server/strata";
import { getPagesDomain } from "@/server/pagesDomain";
import {
  slugify,
  isValidSlugSegment,
  isReservedTopLevelSlug,
  ensureUniqueSlug,
  isSameOrAncestor,
  getPageTree,
  pathForPage,
  getDescendantIds,
} from "@/server/slug";
import { BLOG_MCP_TOOLS, BLOG_TOOL_NAMES, handleBlogTool } from "./blogTools";

const SUBDOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const DOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

const RESERVED_SUBDOMAINS = new Set([
  "admin", "api", "auth", "dashboard", "plexobuilder", "www", "localhost", "dev",
  "test", "prod", "staging", "status", "dns", "mail", "email", "support", "help",
  "static", "assets", "sdk", "pub", "published", "templates", "compile", "settings",
  "profile", "domains", "account", "login", "register", "signup", "logout", "signin"
]);

const SCHEMA_HINT =
  "Every row must already be a fully hydrated layout: { id, style, columns: [{ id, width, elements: [{ id, type, style, attributes }] }] }. " +
  "Shorthand content blocks like { \"type\": \"products\", \"content\": { \"items\": [...] } } are not accepted here — expand each item into its own " +
  "column with real elements (e.g. one column per product, each with a heading/image/paragraph for name/price/description) before calling this tool. " +
  "See this tool's description for a full worked example.";

/**
 * Validates designJson against the exact same TemplateJSONSchema the dashboard's
 * own save endpoint enforces. Throws with an actionable message (fed back to the
 * calling AI as an MCP tool error) instead of silently accepting a lossy shape —
 * callers get one clean shot to retry with the corrected, fully hydrated JSON.
 */
function validateDesignJson(rawDesignJson: any): any {
  const hydrated = hydrateStructuralDefaults(rawDesignJson);
  const validation = TemplateJSONSchema.safeParse(hydrated);
  if (!validation.success) {
    throw new Error(`designJson failed schema validation: ${formatValidationIssues(validation.error)}. ${SCHEMA_HINT}`);
  }
  return validation.data;
}

/**
 * Validates and links a domain to an existing template — shared by
 * publish_landing_page (domain arg on a freshly-created template) and
 * publish_existing_landing_page (an already-existing one). Correctly
 * rejects re-linking a domain owned by a different account (409-equivalent
 * thrown error) — the same check app/api/v1/publish/route.ts's REST
 * counterpart already enforces.
 */
async function linkDomainToTemplate(
  resolved: { userId: string; organizationId: string; subscriptionPlan: string; customDomainLimit: number | null },
  templateId: string,
  rawDomainInput: string,
  domainTypeInput?: "SUBDOMAIN" | "CUSTOM"
): Promise<{ finalDomain: string; publishedUrl: string }> {
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
    finalDomain = `${rawDomain}.${pagesDomain}`;
  } else {
    if (!DOMAIN_REGEX.test(rawDomain)) {
      throw new Error("Invalid custom domain format.");
    }
    if (rawDomain.endsWith("." + pagesDomain) || rawDomain === pagesDomain) {
      throw new Error("Custom domains cannot end with the platform pages domain.");
    }
  }

  const currentDomainCount = await prisma.publishedDomain.count({ where: { organizationId: resolved.organizationId } });
  const domainLimit = getDomainLimit(resolved.subscriptionPlan, resolved.customDomainLimit);
  if (currentDomainCount >= domainLimit) {
    throw new Error(`Published domain limit reached (${domainLimit}). Unlink an existing domain to publish a new one.`);
  }

  const existingDomain = await prisma.publishedDomain.findUnique({ where: { domain: finalDomain } });
  if (existingDomain) {
    if (existingDomain.organizationId !== resolved.organizationId) {
      throw new Error(`Domain '${finalDomain}' is already registered by another account.`);
    }
    await prisma.publishedDomain.update({
      where: { id: existingDomain.id },
      data: { templateId, type: domainType },
    });
  } else {
    // Previously missing entirely for the MCP path: without this, a CUSTOM domain got
    // a database row but was never actually attached to the Vercel project, so it had
    // no valid routing or TLS cert and would never work when visited.
    if (domainType === "CUSTOM") {
      await addVercelDomain(finalDomain);
    }
    await prisma.publishedDomain.create({
      data: { userId: resolved.userId, organizationId: resolved.organizationId, templateId, domain: finalDomain, type: domainType },
    });
  }

  const protocol = process.env.NODE_ENV === "development" ? "http" : "https";
  return { finalDomain, publishedUrl: `${protocol}://${finalDomain}` };
}

export const PLEXO_MCP_TOOLS = [
  {
    name: "publish_landing_page",
    description: `Creates, compiles, and publishes a landing page template to a subdomain or custom domain in 1 step.

IMPORTANT INSTRUCTION FOR AI CLIENTS:
The designJson argument MUST be a fully hydrated layout tree containing body style and rows array. There is no shorthand format —
do NOT send rows shaped like { "type": "products", "content": { "items": [...] } }. That will be REJECTED with a validation error.
Every row MUST already contain a 'columns' array with percentage widths ('100%', '50%', '33.33%'), and each column MUST contain an
'elements' array with fully-styled component objects ('heading', 'paragraph', 'button', 'card', 'image', 'menu', 'social', 'divider',
'spacer', 'form_container'). For any repeated-item section (products, features, testimonials, pricing tiers, etc.) YOU must expand
each item into its own column with real elements — one column per item — rather than passing a list for the server to interpret.

EXAMPLE VALID designJson PAYLOAD (hero row, plus a 3-item product grid row):
{
  "body": {
    "style": { "backgroundColor": "#08090f", "color": "#f0f2ff", "fontFamily": "Inter, sans-serif", "htmlTitle": "Bulum SaaS Platform" },
    "rows": [
      {
        "id": "row-hero",
        "style": { "paddingTop": "80px", "paddingBottom": "80px" },
        "columns": [
          {
            "id": "col-hero",
            "width": "100%",
            "elements": [
              { "type": "heading", "style": { "fontSize": "48px", "fontWeight": "800", "textAlign": "center", "color": "#ffffff" }, "attributes": { "text": "Build & Scale Faster" } },
              { "type": "paragraph", "style": { "fontSize": "18px", "color": "#94a3b8", "textAlign": "center" }, "attributes": { "text": "The ultimate platform for modern digital teams." } },
              { "type": "button", "style": { "textAlign": "center", "backgroundColor": "#8b5cf6", "color": "#ffffff", "borderRadius": "12px", "paddingTop": "14px", "paddingBottom": "14px", "paddingLeft": "28px", "paddingRight": "28px" }, "attributes": { "text": "Start Free Trial", "href": "#signup" } }
            ]
          }
        ]
      },
      {
        "id": "row-products",
        "style": { "paddingTop": "60px", "paddingBottom": "60px" },
        "columns": [
          { "id": "col-product-1", "width": "33.33%", "elements": [
            { "type": "image", "style": { "width": "100%", "borderRadius": "12px" }, "attributes": { "src": "https://...", "alt": "Urban Runner" } },
            { "type": "heading", "style": { "fontSize": "20px", "marginTop": "12px" }, "attributes": { "text": "Urban Runner" } },
            { "type": "paragraph", "style": { "fontSize": "14px", "color": "#94a3b8" }, "attributes": { "text": "Lightweight sneakers for daily adventures" } },
            { "type": "paragraph", "style": { "fontSize": "16px", "fontWeight": "700", "color": "#8b5cf6" }, "attributes": { "text": "$89" } }
          ] },
          { "id": "col-product-2", "width": "33.33%", "elements": [
            { "type": "image", "style": { "width": "100%", "borderRadius": "12px" }, "attributes": { "src": "https://...", "alt": "Classic Court" } },
            { "type": "heading", "style": { "fontSize": "20px", "marginTop": "12px" }, "attributes": { "text": "Classic Court" } },
            { "type": "paragraph", "style": { "fontSize": "14px", "color": "#94a3b8" }, "attributes": { "text": "Timeless style with modern comfort" } },
            { "type": "paragraph", "style": { "fontSize": "16px", "fontWeight": "700", "color": "#8b5cf6" }, "attributes": { "text": "$79" } }
          ] },
          { "id": "col-product-3", "width": "33.33%", "elements": [
            { "type": "image", "style": { "width": "100%", "borderRadius": "12px" }, "attributes": { "src": "https://...", "alt": "Street Flex" } },
            { "type": "heading", "style": { "fontSize": "20px", "marginTop": "12px" }, "attributes": { "text": "Street Flex" } },
            { "type": "paragraph", "style": { "fontSize": "14px", "color": "#94a3b8" }, "attributes": { "text": "Flexible performance footwear" } },
            { "type": "paragraph", "style": { "fontSize": "16px", "fontWeight": "700", "color": "#8b5cf6" }, "attributes": { "text": "$99" } }
          ] }
        ]
      }
    ]
  }
}`,
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Title or brand name of the landing page (e.g. 'Kicks Store', 'Bulum SaaS')",
        },
        designJson: {
          type: "object",
          description: "Plexo layout schema object generated by the AI containing body style and rows array with columns and elements.",
          required: ["body"],
          properties: {
            body: {
              type: "object",
              required: ["style", "rows"],
              properties: {
                style: {
                  type: "object",
                  description: "Global CSS style and page metadata.",
                  required: ["backgroundColor", "color", "fontFamily", "htmlTitle"],
                  properties: {
                    backgroundColor: {
                      type: "string",
                      description: "Background color of the page in hex format (e.g. '#08090f' for dark mode, '#ffffff' for light mode)."
                    },
                    color: {
                      type: "string",
                      description: "Default text color of the page in hex format (e.g. '#f0f2ff' for dark mode, '#1e293b' for light mode)."
                    },
                    fontFamily: {
                      type: "string",
                      description: "Font family of the page text (e.g. 'Inter, sans-serif')."
                    },
                    htmlTitle: {
                      type: "string",
                      description: "The HTML title of the page (matches the brand name or page title, e.g. 'Bulum SaaS Platform')."
                    }
                  }
                },
                rows: {
                  type: "array",
                  description: "Array of row objects. Every row MUST already have a 'columns' array — there is no shorthand row type; rows without 'columns' are rejected.",
                  items: {
                    type: "object",
                    required: ["id", "style", "columns"],
                    properties: {
                      id: { type: "string" },
                      style: { type: "object" },
                      columns: {
                        type: "array",
                        description: "Required. One entry per column — for a repeated-item section (products, features, testimonials), put one item per column here, not a nested list.",
                        items: {
                          type: "object",
                          required: ["id", "width", "elements"],
                          properties: {
                            id: { type: "string" },
                            width: { type: "string", description: "Percentage width (e.g. '100%', '50%', '33.33%')." },
                            elements: {
                              type: "array",
                              items: {
                                type: "object",
                                required: ["id", "type", "style", "attributes"],
                                properties: {
                                  type: {
                                    type: "string",
                                    enum: ["heading", "paragraph", "text", "button", "card", "image", "menu", "social", "divider", "spacer", "form_container", "input", "textarea", "select", "carousel", "html", "icon", "table", "timer", "video", "accordion", "blog_title", "blog_content", "blog_featured_image", "blog_date", "blog_author", "blog_categories", "blog_comments", "blog_post_list"],
                                  },
                                  style: { type: "object" },
                                  attributes: { type: "object", description: "Component attributes (text, href, src, title, description, links, fields). For type 'html', raw markup goes under 'htmlContent' — NOT 'text'." },
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        compiledHtml: {
          type: "string",
          description: "Ignored. HTML is always compiled server-side from the validated designJson (and sanitized) so the published page can never drift from what's editable in the Plexo dashboard.",
        },
        domain: {
          type: "string",
          description: "Subdomain slug (e.g. 'kicks', 'bulum') or custom domain ('kicks.com')",
        },
        type: {
          type: "string",
          enum: ["SUBDOMAIN", "CUSTOM"],
          description: "Domain routing type (SUBDOMAIN or CUSTOM)",
        },
      },
      required: ["name", "designJson"],
    },
  },
  {
    name: "create_email_template",
    description: `Creates and saves a responsive HTML email template for newsletters or promotional campaigns.

Uses the SAME fully-hydrated layout schema as publish_landing_page — designJson MUST be { "body": { "style": {...}, "rows": [{ "id", "style", "columns": [{ "id", "width", "elements": [{ "id", "type", "style", "attributes" }] }] }] } }. There is no shorthand row format; rows without a 'columns' array are rejected. Text content for heading/paragraph/text/button elements MUST be under attributes.text (NOT attributes.content) — a "content" key is silently ignored by the editor and renders as empty/placeholder text. See publish_landing_page's description for a full worked example.`,
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Subject line or template title (e.g. 'Weekly Newsletter #42')",
        },
        designJson: {
          type: "object",
          description: "Plexo layout schema object (same shape as publish_landing_page's designJson) containing body style and a fully hydrated rows array with columns and elements.",
          required: ["body"],
          properties: {
            body: {
              type: "object",
              required: ["style", "rows"],
              properties: {
                style: {
                  type: "object",
                  description: "Global CSS style and page metadata.",
                  required: ["backgroundColor", "color", "fontFamily", "htmlTitle"],
                  properties: {
                    backgroundColor: { type: "string", description: "Background color of the email in hex format (e.g. '#F4F2F8')." },
                    color: { type: "string", description: "Default text color of the email in hex format." },
                    fontFamily: { type: "string", description: "Font family of the email text (e.g. 'Arial, Helvetica, sans-serif')." },
                    htmlTitle: { type: "string", description: "The HTML title of the email (matches the subject/brand name)." },
                  },
                },
                rows: {
                  type: "array",
                  description: "Array of row objects. Every row MUST already have a 'columns' array — there is no shorthand row type; rows without 'columns' are rejected.",
                  items: {
                    type: "object",
                    required: ["id", "style", "columns"],
                    properties: {
                      id: { type: "string" },
                      style: { type: "object" },
                      columns: {
                        type: "array",
                        description: "Required. One entry per column.",
                        items: {
                          type: "object",
                          required: ["id", "width", "elements"],
                          properties: {
                            id: { type: "string" },
                            width: { type: "string", description: "Percentage width (e.g. '100%', '50%', '33.33%')." },
                            elements: {
                              type: "array",
                              items: {
                                type: "object",
                                required: ["id", "type", "style", "attributes"],
                                properties: {
                                  type: {
                                    type: "string",
                                    enum: ["heading", "paragraph", "text", "button", "card", "image", "menu", "social", "divider", "spacer", "form_container", "input", "textarea", "select", "carousel", "html", "icon", "table", "timer", "video", "accordion", "blog_title", "blog_content", "blog_featured_image", "blog_date", "blog_author", "blog_categories", "blog_comments", "blog_post_list"],
                                  },
                                  style: { type: "object" },
                                  attributes: {
                                    type: "object",
                                    description: "Component attributes. IMPORTANT: text content for 'heading'/'paragraph'/'text'/'button' elements goes under the key 'text' (NOT 'content'). Images use 'src'/'alt'. Buttons/links use 'href'. Raw markup for type 'html' goes under 'htmlContent' (NOT 'text').",
                                    properties: {
                                      text: { type: "string", description: "Visible text for heading/paragraph/text/button elements." },
                                      href: { type: "string", description: "Link URL for button/card elements." },
                                      src: { type: "string", description: "Image URL for image elements." },
                                      alt: { type: "string", description: "Alt text for image elements." },
                                      htmlContent: { type: "string", description: "Raw HTML markup for type 'html' elements only." },
                                    },
                                  },
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        compiledHtml: {
          type: "string",
          description: "Ignored. HTML is always compiled server-side from the validated designJson (and sanitized).",
        },
      },
      required: ["name", "designJson"],
    },
  },
  {
    name: "get_strata_tokens",
    description: `Checks whether the account has a Strata design-system project connected and, if so, fetches its design tokens (colors, typography, spacing, etc).

Call this BEFORE publish_landing_page or create_email_template whenever the user wants their brand/Strata colors and styles used. Call with no arguments first to check the currently connected project. If the result has "connected": false, ask the user for their Strata project id (found in their Strata project's snapshot/share URL) and call this tool again with that projectId — it connects the account to that project (remembered for future calls) and fetches its tokens in the same call.

Map the returned tokens into designJson style fields: color-type tokens into backgroundColor/color/borderColor, spacing-type tokens into padding/margin values, and any font-related tokens into fontFamily/fontSize. Prefer tokens whose "name" hints at their role (e.g. a name containing "primary", "background", "text", "accent").`,
    inputSchema: {
      type: "object",
      properties: {
        projectId: {
          type: "string",
          description: "Optional. The user's Strata project id to connect (or switch to). Omit to check/use the previously connected project, if any.",
        },
      },
    },
  },
  {
    name: "update_template",
    description: `Edits an existing landing page or email template in place, under the same template ID. Recompiles and re-saves the HTML from the new designJson — the editable URL stays the same, and for a published landing page the live URL and domain are unchanged too (this does not publish/unpublish or change the domain; call publish_landing_page again with a domain for that).

Uses the SAME fully-hydrated layout schema as publish_landing_page/create_email_template — designJson MUST be { "body": { "style": {...}, "rows": [{ "id", "style", "columns": [{ "id", "width", "elements": [{ "id", "type", "style", "attributes" }] }] }] } }. There is no shorthand row format; rows without a 'columns' array are rejected, and this replaces the ENTIRE designJson — to edit one section, fetch the current template's designJson first (via list_landing_pages/list_email_templates, or the Plexo dashboard) and send back the full modified tree, not just the changed part. See publish_landing_page's description for a full worked example.`,
    inputSchema: {
      type: "object",
      properties: {
        templateId: {
          type: "string",
          description: "ID of the template to update — the templateId returned by publish_landing_page, create_email_template, list_landing_pages, or list_email_templates.",
        },
        name: {
          type: "string",
          description: "Optional new title for the template. Omit to keep the existing name.",
        },
        designJson: {
          type: "object",
          description: "The FULL replacement Plexo layout schema (same shape as publish_landing_page's designJson) — not a partial patch.",
        },
        compiledHtml: {
          type: "string",
          description: "Ignored. HTML is always compiled server-side from the validated designJson (and sanitized).",
        },
      },
      required: ["templateId", "designJson"],
    },
  },
  {
    name: "create_landing_page",
    description: `Creates and saves a landing page template WITHOUT publishing it to a domain — use this when the user wants to build a page (or start a multi-page site) first and go live later. Call publish_existing_landing_page afterward with the returned templateId to link a subdomain or custom domain whenever they're ready. To create a page AND publish it in one step, use publish_landing_page instead.

Uses the SAME fully-hydrated layout schema as publish_landing_page — designJson MUST be { "body": { "style": {...}, "rows": [{ "id", "style", "columns": [{ "id", "width", "elements": [...] }] }] } }. See publish_landing_page's description for a full worked example.`,
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Title of the landing page (e.g. 'Kicks Store').",
        },
        designJson: {
          type: "object",
          description: "Plexo layout schema object — same shape as publish_landing_page's designJson.",
        },
      },
      required: ["name", "designJson"],
    },
  },
  {
    name: "publish_existing_landing_page",
    description: `Links a subdomain or custom domain to an already-existing landing page template — for a template created via create_landing_page, or the home page of a multi-page site (see create_landing_page_subpage) once its sub-pages are ready. Unlike publish_landing_page, this does NOT create a new template — it publishes the one you already have. Every sub-page nested under templateId automatically becomes reachable at this domain too (e.g. domain.com/about) — no separate publish call is needed per sub-page.`,
    inputSchema: {
      type: "object",
      properties: {
        templateId: {
          type: "string",
          description: "ID of an existing landing page template to publish — must be a home page (no parent), not a sub-page.",
        },
        domain: {
          type: "string",
          description: "Subdomain slug (e.g. 'kicks') or custom domain ('kicks.com').",
        },
        type: {
          type: "string",
          enum: ["SUBDOMAIN", "CUSTOM"],
          description: "Domain routing type. Inferred from the domain string if omitted.",
        },
      },
      required: ["templateId", "domain"],
    },
  },
  {
    name: "create_landing_page_subpage",
    description: `Adds a new page nested under an existing landing page, reachable at <site domain>/<slug> — or nested deeper (e.g. /blog/post-1) if parentTemplateId is itself a sub-page rather than the home page. This is how a single landing page becomes a multi-page site. No separate publish step is needed for sub-pages: they automatically become reachable once the site's home page has a domain linked (see publish_existing_landing_page). Requires an Ultra subscription plan — sub-pages are otherwise unlimited per site once enabled (the plan's template limit only counts home pages, not their sub-pages).

designJson is optional — omit it to create a blank page (fill it in afterward with update_template using the returned templateId), or provide it to populate content in the same call. Uses the same fully-hydrated layout schema as publish_landing_page.`,
    inputSchema: {
      type: "object",
      properties: {
        parentTemplateId: {
          type: "string",
          description: "ID of the page this new page should be nested under — the site's home page for a top-level page (e.g. /about), or another sub-page's ID to nest deeper (e.g. a 'Blog' page's ID to create /blog/post-1).",
        },
        name: {
          type: "string",
          description: "Friendly name of the page (e.g. 'About Us').",
        },
        slug: {
          type: "string",
          description: "Optional URL segment (e.g. 'about-us'). Auto-generated from name if omitted; auto-suffixed (about-us-2, ...) if it collides with a sibling page under the same parent.",
        },
        designJson: {
          type: "object",
          description: "Optional. Plexo layout schema object — same shape as publish_landing_page's designJson. Omit to create a blank page.",
        },
      },
      required: ["parentTemplateId", "name"],
    },
  },
  {
    name: "get_landing_page_pages",
    description: "Returns every page belonging to the same multi-page site as the given template — its home page plus all nested sub-pages, each with its name, URL segment (slug), parent, and full resolved path (e.g. '/blog/post-1'). Pass the home page's ID or any sub-page's ID — either way you get the whole tree back. Use this before create_landing_page_subpage/update_landing_page_page when you need to know what pages already exist or what a page's current slug/parent is.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: {
          type: "string",
          description: "ID of the site's home page, or any sub-page within it.",
        },
      },
      required: ["templateId"],
    },
  },
  {
    name: "update_landing_page_page",
    description: `Renames a page, changes its URL segment (slug), moves it under a different parent page, or reorders it among its siblings. The home page of a site (no parent) can be renamed but has no slug of its own and can't be re-parented — use publish_existing_landing_page to manage its domain instead.

To edit a page's CONTENT (designJson), use update_template with the same templateId instead — this tool only manages the page's place in the site's structure, not what's on it.`,
    inputSchema: {
      type: "object",
      properties: {
        templateId: {
          type: "string",
          description: "ID of the page to update.",
        },
        name: {
          type: "string",
          description: "Optional new name.",
        },
        slug: {
          type: "string",
          description: "Optional new URL segment. Not allowed for the home page.",
        },
        parentTemplateId: {
          type: "string",
          description: "Optional new parent page ID, to move this page elsewhere in the site's tree. Rejected if it would create a cycle (e.g. moving a page underneath its own sub-page).",
        },
        order: {
          type: "number",
          description: "Optional sort position among sibling pages under the same parent (lower = earlier).",
        },
      },
      required: ["templateId"],
    },
  },
  {
    name: "delete_template",
    description: "Permanently deletes any landing page or email template by templateId or template name (e.g. 'buzm'). Cleans up attached sub-pages, Vercel Blob assets, and custom domain routing. Confirm with user before calling as this action cannot be undone.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: {
          type: "string",
          description: "ID of the template or page to delete (UUID, or exact/partial template name like 'buzm').",
        },
        name: {
          type: "string",
          description: "Optional template name or search phrase if templateId is unknown (e.g. 'buzm').",
        },
      },
    },
  },
  {
    name: "delete_landing_page_page",
    description: "Deletes a page. If it has sub-pages nested under it, they're deleted too (cascade) — the response reports how many. Deleting a site's home page deletes the whole site, including every page nested under it and its published domain link — this can't be undone, confirm with the user first.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: {
          type: "string",
          description: "ID of the page to delete.",
        },
      },
      required: ["templateId"],
    },
  },
  {
    name: "duplicate_landing_page_page",
    description: "Clones a sub-page's content into a new sibling page under the same parent — handy for building several similar pages (e.g. multiple product pages) without starting blank. Not available for a site's home page. Requires an Ultra subscription plan.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: {
          type: "string",
          description: "ID of the sub-page to duplicate — must not be a home page.",
        },
      },
      required: ["templateId"],
    },
  },
  {
    name: "list_landing_pages",
    description: "Lists all saved landing page templates and published domain URLs in the user's Plexo account.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "list_email_templates",
    description: "Lists all saved email templates in the user's Plexo account.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_analytics",
    description: "Fetches visitor analytics, total page views, unique visitor counts, and daily timeline metrics.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: {
          type: "string",
          description: "Optional template ID to filter analytics",
        },
      },
    },
  },
  {
    name: "get_user_profile",
    description: "Retrieves user details, subscription plan (FREE, PRO, ULTRA), AI credit balance, and domain usage limits.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "delete_published_domain",
    description: "Deletes or unlinks a published domain routing from a landing page.",
    inputSchema: {
      type: "object",
      properties: {
        domain: {
          type: "string",
          description: "Domain name to delete (e.g. 'acme.plexobuilder.com')",
        },
        domainId: {
          type: "string",
          description: "ID of the published domain record",
        },
      },
    },
  },
  ...BLOG_MCP_TOOLS,
];

export async function handleMcpJsonRpc(request: NextRequest, body: any): Promise<NextResponse> {
  const jsonrpc = body?.jsonrpc || "2.0";
  const id = body?.id ?? null;
  const method = body?.method;

  // 1. Handle initialize handshake
  if (method === "initialize") {
    return NextResponse.json({
      jsonrpc,
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: "Plexo MCP Server",
          version: "1.0.0",
        },
      },
    });
  }

  // 2. Handle tools/list
  if (method === "tools/list") {
    return NextResponse.json({
      jsonrpc,
      id,
      result: {
        tools: PLEXO_MCP_TOOLS,
      },
    });
  }

  // 3. Handle tools/call
  if (method === "tools/call") {
    const toolName = body?.params?.name;
    const args = body?.params?.arguments || {};

    const resolved = await resolveUser(request);
    if (!resolved) {
      const loginUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://plexo.charisol.io"}/mcp/login`;
      return NextResponse.json({
        jsonrpc,
        id,
        result: {
          content: [
            {
              type: "text",
              text: `Authentication Required: Valid API key or OAuth session required.\nPlease authorize at ${loginUrl}`,
            },
          ],
          isError: true,
        },
      });
    }

    try {
      let toolResult: any;

      switch (toolName) {
        case "publish_landing_page": {
          const features = getTierFeatures(resolved.subscriptionPlan);
          {
            const rootCount = await prisma.template.count({ where: { organizationId: resolved.organizationId, parentId: null, kind: "LANDING_PAGE" } });
            if (rootCount >= features.maxLandingPages) {
              throw new Error(`Template limit reached (${features.maxLandingPages} landing pages). Upgrade plan to create more.`);
            }
          }

          const name = args.name?.trim() || "AI Landing Page";
          let rawDesignJson = args.designJson;

          if (typeof rawDesignJson === "string") {
            try {
              rawDesignJson = JSON.parse(rawDesignJson);
            } catch (e) {
              rawDesignJson = null;
            }
          }

          if (!rawDesignJson || typeof rawDesignJson !== "object") {
            throw new Error("designJson object is required to compile and publish a landing page. Please provide a valid Plexo layout schema.");
          }

          const designJson = validateDesignJson(rawDesignJson);
          if (designJson.body.style) {
            designJson.body.style.htmlTitle = designJson.body.style.htmlTitle || name;
          }
          // compiledHtml is always derived server-side from the validated designJson (never
          // trusted from the caller) so the published page can never drift from what's
          // editable in the dashboard, and so an AI client can't hand us raw HTML/script.
          const compiledHtml = sanitizeHtml(compileToHTML(designJson));
          let rawDomain = args.domain?.trim().toLowerCase() || "";
          let domainType = args.type as "SUBDOMAIN" | "CUSTOM" | undefined;

          const template = await prisma.template.create({
            data: {
              userId: resolved.userId,
              organizationId: resolved.organizationId,
              name,
              kind: "LANDING_PAGE",
              designJson,
              compiledHtml,
            },
          });

          const baseAppUrl = process.env.NEXT_PUBLIC_APP_URL || "https://plexo.charisol.io";
          const editableUrl = `${baseAppUrl}/dashboard/templates/${template.id}`;

          if (!rawDomain) {
            toolResult = {
              success: true,
              templateId: template.id,
              name: template.name,
              editableUrl,
              publishedUrl: null,
            };
            break;
          }

          const { finalDomain, publishedUrl } = await linkDomainToTemplate(resolved, template.id, rawDomain, domainType);
          toolResult = {
            success: true,
            templateId: template.id,
            name: template.name,
            domain: finalDomain,
            publishedUrl,
            editableUrl,
          };
          break;
        }

        case "create_email_template": {
          const features = getTierFeatures(resolved.subscriptionPlan);
          {
            const rootCount = await prisma.template.count({ where: { organizationId: resolved.organizationId, parentId: null, kind: "EMAIL" } });
            if (rootCount >= features.maxEmailTemplates) {
              throw new Error(`Template limit reached (${features.maxEmailTemplates} email templates). Upgrade plan to create more.`);
            }
          }

          const name = args.name?.trim() || "AI Email Template";
          let rawDesignJson = args.designJson;

          if (typeof rawDesignJson === "string") {
            try {
              rawDesignJson = JSON.parse(rawDesignJson);
            } catch (e) {
              rawDesignJson = null;
            }
          }

          if (!rawDesignJson || typeof rawDesignJson !== "object") {
            throw new Error("designJson object is required to create an email template.");
          }

          const designJson = validateDesignJson(rawDesignJson);
          const compiledHtml = sanitizeHtml(compileToHTML(designJson));
          const template = await prisma.template.create({
            data: {
              userId: resolved.userId,
              organizationId: resolved.organizationId,
              name,
              kind: "EMAIL",
              designJson,
              compiledHtml,
            },
          });

          const baseAppUrl = process.env.NEXT_PUBLIC_APP_URL || "https://plexo.charisol.io";
          toolResult = {
            success: true,
            templateId: template.id,
            name: template.name,
            editableUrl: `${baseAppUrl}/dashboard/templates/${template.id}`,
          };
          break;
        }

        case "update_template": {
          const templateId = typeof args.templateId === "string" ? args.templateId.trim() : "";
          if (!templateId) {
            throw new Error("templateId is required to update a template.");
          }

          const existing = await prisma.template.findFirst({
            where: { id: templateId, organizationId: resolved.organizationId },
            select: { id: true, kind: true, name: true },
          });
          if (!existing) {
            throw new Error(`No template found with id "${templateId}" in this account. Use list_landing_pages or list_email_templates to look up the correct id.`);
          }

          let rawDesignJson = args.designJson;
          if (typeof rawDesignJson === "string") {
            try {
              rawDesignJson = JSON.parse(rawDesignJson);
            } catch (e) {
              rawDesignJson = null;
            }
          }
          if (!rawDesignJson || typeof rawDesignJson !== "object") {
            throw new Error("designJson object is required to update a template. Please provide the full replacement Plexo layout schema.");
          }

          const name = args.name?.trim() || existing.name;
          const designJson = validateDesignJson(rawDesignJson);
          if (designJson.body.style) {
            designJson.body.style.htmlTitle = designJson.body.style.htmlTitle || name;
          }
          const compiledHtml = sanitizeHtml(compileToHTML(designJson));

          const updated = await prisma.template.update({
            where: { id: existing.id },
            data: { name, designJson, compiledHtml },
          });

          const baseAppUrl = process.env.NEXT_PUBLIC_APP_URL || "https://plexo.charisol.io";
          const editableUrl = `${baseAppUrl}/dashboard/templates/${updated.id}`;

          let publishedUrl: string | null = null;
          if (existing.kind === "LANDING_PAGE") {
            const domain = await prisma.publishedDomain.findFirst({
              where: { templateId: updated.id },
              select: { domain: true },
            });
            if (domain) {
              const protocol = process.env.NODE_ENV === "development" ? "http" : "https";
              publishedUrl = `${protocol}://${domain.domain}`;
            }
          }

          toolResult = {
            success: true,
            templateId: updated.id,
            name: updated.name,
            kind: existing.kind,
            editableUrl,
            publishedUrl,
          };
          break;
        }

        case "create_landing_page": {
          const features = getTierFeatures(resolved.subscriptionPlan);
          {
            // Root/home pages only — a page's sub-pages don't count against this limit.
            const rootCount = await prisma.template.count({ where: { organizationId: resolved.organizationId, parentId: null, kind: "LANDING_PAGE" } });
            if (rootCount >= features.maxLandingPages) {
              throw new Error(`Template limit reached (${features.maxLandingPages} landing pages). Upgrade plan to create more.`);
            }
          }

          const name = args.name?.trim() || "AI Landing Page";
          let rawDesignJson = args.designJson;
          if (typeof rawDesignJson === "string") {
            try {
              rawDesignJson = JSON.parse(rawDesignJson);
            } catch (e) {
              rawDesignJson = null;
            }
          }
          if (!rawDesignJson || typeof rawDesignJson !== "object") {
            throw new Error("designJson object is required to create a landing page.");
          }

          const designJson = validateDesignJson(rawDesignJson);
          if (designJson.body.style) {
            designJson.body.style.htmlTitle = designJson.body.style.htmlTitle || name;
          }
          const compiledHtml = sanitizeHtml(compileToHTML(designJson));

          const template = await prisma.template.create({
            data: { userId: resolved.userId, organizationId: resolved.organizationId, name, kind: "LANDING_PAGE", designJson, compiledHtml },
          });

          const baseAppUrl = process.env.NEXT_PUBLIC_APP_URL || "https://plexo.charisol.io";
          toolResult = {
            success: true,
            templateId: template.id,
            name: template.name,
            editableUrl: `${baseAppUrl}/dashboard/templates/${template.id}`,
            publishedUrl: null,
            message: "Landing page created without publishing. Call publish_existing_landing_page with this templateId when ready to go live, or create_landing_page_subpage to add more pages to it first.",
          };
          break;
        }

        case "publish_existing_landing_page": {
          const templateId = typeof args.templateId === "string" ? args.templateId.trim() : "";
          if (!templateId) {
            throw new Error("templateId is required.");
          }
          const rawDomain = typeof args.domain === "string" ? args.domain : "";
          if (!rawDomain.trim()) {
            throw new Error("domain is required.");
          }

          const template = await prisma.template.findFirst({
            where: { id: templateId, organizationId: resolved.organizationId, kind: "LANDING_PAGE" },
            select: { id: true, name: true },
          });
          if (!template) {
            throw new Error(`No landing page template found with id "${templateId}" in this account. Use list_landing_pages to look up the correct id.`);
          }

          const domainType = args.type === "SUBDOMAIN" || args.type === "CUSTOM" ? args.type : undefined;
          const { finalDomain, publishedUrl } = await linkDomainToTemplate(resolved, template.id, rawDomain, domainType);

          const baseAppUrl = process.env.NEXT_PUBLIC_APP_URL || "https://plexo.charisol.io";
          toolResult = {
            success: true,
            templateId: template.id,
            name: template.name,
            domain: finalDomain,
            publishedUrl,
            editableUrl: `${baseAppUrl}/dashboard/templates/${template.id}`,
          };
          break;
        }

        case "create_landing_page_subpage": {
          const features = getTierFeatures(resolved.subscriptionPlan);
          if (!features.multiPageSitesEnabled) {
            throw new Error("Multi-page sites require an Ultra subscription plan.");
          }

          const parentTemplateId = typeof args.parentTemplateId === "string" ? args.parentTemplateId.trim() : "";
          const name = typeof args.name === "string" ? args.name.trim() : "";
          if (!parentTemplateId || !name) {
            throw new Error("parentTemplateId and name are required to create a sub-page.");
          }

          const parent = await prisma.template.findFirst({
            where: { id: parentTemplateId, organizationId: resolved.organizationId },
            select: { id: true, kind: true },
          });
          if (!parent) {
            throw new Error(`No page found with id "${parentTemplateId}" in this account.`);
          }
          if (parent.kind !== "LANDING_PAGE") {
            throw new Error("Only landing pages can have sub-pages.");
          }

          let rawDesignJson = args.designJson;
          if (typeof rawDesignJson === "string") {
            try {
              rawDesignJson = JSON.parse(rawDesignJson);
            } catch (e) {
              rawDesignJson = null;
            }
          }

          let designJson: any;
          let compiledHtml: string;
          if (rawDesignJson && typeof rawDesignJson === "object") {
            designJson = validateDesignJson(rawDesignJson);
            if (designJson.body.style) {
              designJson.body.style.htmlTitle = designJson.body.style.htmlTitle || name;
            }
            compiledHtml = sanitizeHtml(compileToHTML(designJson));
          } else {
            designJson = { body: { style: { background: "#0b0f19", padding: "24px" }, rows: [] } };
            compiledHtml = "";
          }

          const slug = await ensureUniqueSlug(parentTemplateId, (typeof args.slug === "string" && args.slug.trim()) || name);
          const lastSibling = await prisma.template.findFirst({
            where: { parentId: parentTemplateId },
            orderBy: { order: "desc" },
            select: { order: true },
          });

          const page = await prisma.template.create({
            data: {
              userId: resolved.userId,
              organizationId: resolved.organizationId,
              name,
              kind: "LANDING_PAGE",
              parentId: parentTemplateId,
              slug,
              order: (lastSibling?.order ?? -1) + 1,
              designJson,
              compiledHtml,
            },
          });

          const tree = await getPageTree(resolved.organizationId, page.id);
          const path = tree ? pathForPage(page.id, tree.pages) : `/${slug}`;
          const baseAppUrl = process.env.NEXT_PUBLIC_APP_URL || "https://plexo.charisol.io";

          toolResult = {
            success: true,
            templateId: page.id,
            parentTemplateId,
            name: page.name,
            slug: page.slug,
            path,
            editableUrl: `${baseAppUrl}/dashboard/templates/${page.id}`,
          };
          break;
        }

        case "get_landing_page_pages": {
          const templateId = typeof args.templateId === "string" ? args.templateId.trim() : "";
          if (!templateId) {
            throw new Error("templateId is required.");
          }

          const tree = await getPageTree(resolved.organizationId, templateId);
          if (!tree) {
            throw new Error(`No page found with id "${templateId}" in this account.`);
          }

          toolResult = {
            rootId: tree.rootId,
            pages: tree.pages.map((p) => ({
              templateId: p.id,
              name: p.name,
              slug: p.slug,
              parentTemplateId: p.parentId,
              isHomePage: p.parentId === null,
              path: pathForPage(p.id, tree.pages),
              order: p.order,
              sourceType: p.sourceType,
            })),
          };
          break;
        }

        case "update_landing_page_page": {
          const templateId = typeof args.templateId === "string" ? args.templateId.trim() : "";
          if (!templateId) {
            throw new Error("templateId is required.");
          }

          const existing = await prisma.template.findFirst({
            where: { id: templateId, organizationId: resolved.organizationId },
            select: { id: true, parentId: true, slug: true },
          });
          if (!existing) {
            throw new Error(`No page found with id "${templateId}" in this account.`);
          }

          const data: any = {};

          if (typeof args.name === "string" && args.name.trim()) {
            data.name = args.name.trim();
          }

          if (typeof args.slug === "string") {
            if (existing.parentId === null) {
              throw new Error("The home page doesn't have its own URL segment.");
            }
            const nextSlug = slugify(args.slug);
            if (!nextSlug || !isValidSlugSegment(nextSlug)) {
              throw new Error("That page URL isn't valid. Use lowercase letters, numbers, and hyphens.");
            }
            data.slug = nextSlug;
          }

          if (typeof args.parentTemplateId === "string" && args.parentTemplateId.trim()) {
            if (existing.parentId === null) {
              throw new Error("The home page can't be nested under another page.");
            }
            const targetParentId = args.parentTemplateId.trim();
            if (targetParentId === existing.id) {
              throw new Error("A page can't be nested under itself.");
            }
            const targetParent = await prisma.template.findFirst({
              where: { id: targetParentId, organizationId: resolved.organizationId },
              select: { id: true },
            });
            if (!targetParent) {
              throw new Error(`Target parent page "${targetParentId}" not found.`);
            }
            if (await isSameOrAncestor(targetParentId, existing.id)) {
              throw new Error("Can't move a page underneath one of its own sub-pages.");
            }
            data.parentId = targetParentId;
          }

          if (typeof args.order === "number" && Number.isFinite(args.order)) {
            data.order = args.order;
          }

          if (Object.keys(data).length === 0) {
            throw new Error("Provide at least one of name, slug, parentTemplateId, or order to update.");
          }

          const effectiveParentId: string | null = data.parentId ?? existing.parentId;
          const effectiveSlug: string | null = data.slug ?? existing.slug;
          if (effectiveSlug && (await isReservedTopLevelSlug(effectiveParentId as string, effectiveSlug))) {
            throw new Error("That URL is reserved for the site's blog.");
          }

          let updated;
          try {
            updated = await prisma.template.update({
              where: { id: existing.id },
              data,
              select: { id: true, name: true, slug: true, parentId: true, order: true },
            });
          } catch (err: any) {
            if (err?.code === "P2002") {
              throw new Error("A page with this URL already exists here.");
            }
            throw err;
          }

          toolResult = {
            success: true,
            templateId: updated.id,
            name: updated.name,
            slug: updated.slug,
            parentTemplateId: updated.parentId,
            order: updated.order,
          };
          break;
        }

        case "delete_template":
        case "delete_landing_page_page": {
          const queryStr = (typeof args.templateId === "string" ? args.templateId : "") || (typeof args.name === "string" ? args.name : "") || (typeof args.templateName === "string" ? args.templateName : "");
          const rawInput = queryStr.trim();
          if (!rawInput) {
            throw new Error("templateId or template name is required.");
          }

          // 1. First try exact UUID/id match
          let existing = await prisma.template.findFirst({
            where: { id: rawInput, organizationId: resolved.organizationId },
            select: { id: true, parentId: true, name: true, kind: true },
          });

          // 2. If not found by ID, search by case-insensitive name match
          if (!existing) {
            existing = await prisma.template.findFirst({
              where: {
                organizationId: resolved.organizationId,
                OR: [
                  { name: { equals: rawInput, mode: "insensitive" } },
                  { name: { contains: rawInput, mode: "insensitive" } },
                ],
              },
              // Tie-break on createdAt — the org-backfill migration's updateMany bumped
              // every template's updatedAt to the same instant via Prisma's @updatedAt.
              orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
              select: { id: true, parentId: true, name: true, kind: true },
            });
          }

          if (!existing) {
            throw new Error(`No template found matching "${rawInput}" in this account. Use list_landing_pages or list_email_templates to view saved templates.`);
          }

          const descendantIds = await getDescendantIds(resolved.organizationId, existing.id);
          const allIds = [existing.id, ...descendantIds];

          // Same cleanup as the REST DELETE route (app/api/templates/[id]/route.ts) —
          // TemplateAsset rows and PublishedDomain rows cascade at the DB level, but
          // Vercel Blob storage and Vercel's own domain registry have no idea Postgres
          // just deleted anything, so both need explicit cleanup before the cascade.
          const assets = await prisma.templateAsset.findMany({
            where: { templateId: { in: allIds } },
            select: { blobUrl: true },
          });
          if (assets.length > 0) {
            const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
            await del(assets.map((a) => a.blobUrl), blobToken ? { token: blobToken } : undefined).catch((err) =>
              console.error("Failed to delete blobs during MCP page delete (non-fatal):", err)
            );
          }
          const domainsToRemove = await prisma.publishedDomain.findMany({
            where: { templateId: { in: allIds }, type: "CUSTOM" },
            select: { domain: true },
          });
          for (const d of domainsToRemove) {
            await removeVercelDomain(d.domain).catch((err) =>
              console.error(`Failed to remove Vercel domain ${d.domain} during MCP page delete (non-fatal):`, err)
            );
          }

          await prisma.template.delete({ where: { id: existing.id } });

          toolResult = {
            success: true,
            deletedTemplateId: existing.id,
            deletedDescendantCount: descendantIds.length,
            wasHomePage: existing.parentId === null,
          };
          break;
        }

        case "duplicate_landing_page_page": {
          const features = getTierFeatures(resolved.subscriptionPlan);
          if (!features.multiPageSitesEnabled) {
            throw new Error("Multi-page sites require an Ultra subscription plan.");
          }

          const templateId = typeof args.templateId === "string" ? args.templateId.trim() : "";
          if (!templateId) {
            throw new Error("templateId is required.");
          }

          const existing = await prisma.template.findFirst({
            where: { id: templateId, organizationId: resolved.organizationId },
            select: { id: true, name: true, kind: true, parentId: true, slug: true, designJson: true, compiledHtml: true, sourceType: true },
          });
          if (!existing) {
            throw new Error(`No page found with id "${templateId}" in this account.`);
          }
          if (!existing.parentId) {
            throw new Error("The home page can't be duplicated from here.");
          }

          const lastSibling = await prisma.template.findFirst({
            where: { parentId: existing.parentId },
            orderBy: { order: "desc" },
            select: { order: true },
          });

          const name = `${existing.name} copy`;
          const slug = await ensureUniqueSlug(existing.parentId, `${existing.slug ?? name}-copy`);

          // Raw-upload pages own real files in Blob storage — copy them independently
          // rather than sharing a reference, so editing/deleting one page's files can
          // never silently break its duplicate (or vice versa). Same fix as the REST
          // duplicate route (app/api/templates/[id]/duplicate/route.ts) — this tool has
          // its own separate implementation, so it needed the fix separately too.
          const newId = randomUUID();
          let copiedAssets: { templateId: string; path: string; blobUrl: string; contentType: string; size: number }[] = [];
          if (existing.sourceType === "RAW_UPLOAD") {
            const sourceAssets = await prisma.templateAsset.findMany({ where: { templateId: existing.id } });
            if (sourceAssets.length > 0) {
              const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
              copiedAssets = await Promise.all(
                sourceAssets.map(async (asset) => {
                  const sourceRes = await fetch(asset.blobUrl);
                  const buffer = Buffer.from(await sourceRes.arrayBuffer());
                  const blob = await put(`raw-sites/${newId}/${asset.path}`, buffer, {
                    access: "public",
                    contentType: asset.contentType,
                    ...(blobToken ? { token: blobToken } : {}),
                  });
                  return {
                    templateId: newId,
                    path: asset.path,
                    blobUrl: blob.url,
                    contentType: asset.contentType,
                    size: buffer.byteLength,
                  };
                })
              );
            }
          }

          const duplicate = await prisma.template.create({
            data: {
              id: newId,
              userId: resolved.userId,
              organizationId: resolved.organizationId,
              name,
              kind: existing.kind,
              sourceType: existing.sourceType,
              parentId: existing.parentId,
              slug,
              order: (lastSibling?.order ?? -1) + 1,
              designJson: existing.designJson as any,
              compiledHtml: existing.compiledHtml,
            },
          });

          if (copiedAssets.length > 0) {
            await prisma.templateAsset.createMany({ data: copiedAssets });
          }

          const baseAppUrl = process.env.NEXT_PUBLIC_APP_URL || "https://plexo.charisol.io";
          toolResult = {
            success: true,
            templateId: duplicate.id,
            name: duplicate.name,
            slug: duplicate.slug,
            parentTemplateId: duplicate.parentId,
            editableUrl: `${baseAppUrl}/dashboard/templates/${duplicate.id}`,
          };
          break;
        }

        case "list_landing_pages": {
          const templates = await prisma.template.findMany({
            where: { organizationId: resolved.organizationId, kind: "LANDING_PAGE" },
            select: { id: true, name: true, parentId: true, slug: true, createdAt: true, updatedAt: true },
          });
          const domains = await prisma.publishedDomain.findMany({
            where: { organizationId: resolved.organizationId },
            select: { domain: true, type: true, templateId: true },
          });
          toolResult = {
            templates: templates.map((t) => ({ ...t, isHomePage: t.parentId === null })),
            publishedDomains: domains,
          };
          break;
        }

        case "list_email_templates": {
          const templates = await prisma.template.findMany({
            where: { organizationId: resolved.organizationId, kind: "EMAIL" },
            select: { id: true, name: true, createdAt: true, updatedAt: true },
          });
          toolResult = { emailTemplates: templates };
          break;
        }

        case "get_user_profile": {
          const user = await prisma.user.findUnique({
            where: { id: resolved.userId },
            select: { id: true, name: true, email: true, subscriptionPlan: true, allowanceBalance: true, topupBalance: true, customDomainLimit: true },
          });
          const features = getTierFeatures(user?.subscriptionPlan);
          toolResult = { user, features, limit: getDomainLimit(user?.subscriptionPlan ?? "FREE", user?.customDomainLimit ?? null) };
          break;
        }

        case "get_strata_tokens": {
          const incomingProjectId = typeof args.projectId === "string" ? args.projectId : undefined;
          const projectId = await resolveStrataProjectId(resolved.userId, incomingProjectId);

          if (!projectId) {
            toolResult = {
              connected: false,
              projectId: null,
              tokens: [],
              message: "No Strata project connected yet. Pass a projectId to connect (find it in your Strata project's snapshot/share URL).",
            };
            break;
          }

          const result = await fetchStrataTokens(projectId);
          if ("error" in result) {
            toolResult = { connected: false, projectId, tokens: [], error: result.error };
          } else {
            toolResult = { connected: true, projectId, tokenCount: result.tokens.length, tokens: result.tokens };
          }
          break;
        }

        default: {
          if (BLOG_TOOL_NAMES.has(toolName)) {
            toolResult = await handleBlogTool(toolName, args, resolved);
            break;
          }
          throw new Error(`Unknown tool: ${toolName}`);
        }
      }

      return NextResponse.json({
        jsonrpc,
        id,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify(toolResult, null, 2),
            },
          ],
        },
      });
    } catch (err: any) {
      return NextResponse.json({
        jsonrpc,
        id,
        result: {
          content: [
            {
              type: "text",
              text: `Error executing ${toolName}: ${err.message || String(err)}`,
            },
          ],
          isError: true,
        },
      });
    }
  }

  return NextResponse.json({
    jsonrpc,
    id,
    error: {
      code: -32601,
      message: "Method not found",
    },
  });
}
