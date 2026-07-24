import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import { compileToHTML } from "@/lib/compiler";
import { TemplateJSONSchema, hydrateStructuralDefaults, formatValidationIssues, sanitizeHtml } from "@/server/sanitizer";
import { getTierFeatures } from "@/lib/subscription";
import { resolveUser, getDomainLimit } from "@/app/api/v1/domains/route";
import { resolveStrataProjectId, fetchStrataTokens } from "@/server/strata";

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
                                    enum: ["heading", "paragraph", "text", "button", "card", "image", "menu", "social", "divider", "spacer", "form_container", "input", "textarea", "select", "carousel", "html", "icon", "table", "timer", "video"],
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
                                    enum: ["heading", "paragraph", "text", "button", "card", "image", "menu", "social", "divider", "spacer", "form_container", "input", "textarea", "select", "carousel", "html", "icon", "table", "timer", "video"],
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
          if (!features.landingPagesEnabled) {
            throw new Error("Landing page creation requires PRO or ULTRA plan.");
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
              name,
              kind: "LANDING_PAGE",
              designJson,
              compiledHtml,
            },
          });

          const baseAppUrl = process.env.NEXT_PUBLIC_APP_URL || "https://plexo.charisol.io";
          const baseDomain = new URL(baseAppUrl).hostname;
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

          if (!domainType) {
            domainType = rawDomain.includes(".") ? "CUSTOM" : "SUBDOMAIN";
          }

          let finalDomain = rawDomain;
          if (domainType === "SUBDOMAIN") {
            finalDomain = `${rawDomain}.${baseDomain}`;
          }

          const existingDomain = await prisma.publishedDomain.findUnique({
            where: { domain: finalDomain },
          });

          if (existingDomain) {
            await prisma.publishedDomain.update({
              where: { domain: finalDomain },
              data: {
                templateId: template.id,
                userId: resolved.userId,
                type: domainType,
              },
            });
          } else {
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
          toolResult = {
            success: true,
            templateId: template.id,
            name: template.name,
            domain: finalDomain,
            publishedUrl: `${protocol}://${finalDomain}`,
            editableUrl,
          };
          break;
        }

        case "create_email_template": {
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
            where: { id: templateId, userId: resolved.userId },
            select: { id: true, kind: true, name: true },
          });
          if (!existing) {
            throw new Error(`No template found with id "${templateId}" in this account. Use list_landing_pages or list_email_templates to look up the correct id.`);
          }

          if (existing.kind === "LANDING_PAGE") {
            const features = getTierFeatures(resolved.subscriptionPlan);
            if (!features.landingPagesEnabled) {
              throw new Error("Editing a landing page requires PRO or ULTRA plan.");
            }
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

        case "list_landing_pages": {
          const templates = await prisma.template.findMany({
            where: { userId: resolved.userId, kind: "LANDING_PAGE" },
            select: { id: true, name: true, createdAt: true, updatedAt: true },
          });
          const domains = await prisma.publishedDomain.findMany({
            where: { userId: resolved.userId },
            select: { domain: true, type: true, templateId: true },
          });
          toolResult = { templates, publishedDomains: domains };
          break;
        }

        case "list_email_templates": {
          const templates = await prisma.template.findMany({
            where: { userId: resolved.userId, kind: "EMAIL" },
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

        default:
          throw new Error(`Unknown tool: ${toolName}`);
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
