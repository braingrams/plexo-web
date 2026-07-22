import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import { compileToHTML } from "@/lib/compiler";
import { getTierFeatures } from "@/lib/subscription";
import { resolveUser, getDomainLimit } from "@/app/api/v1/domains/route";

const SUBDOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const DOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

const RESERVED_SUBDOMAINS = new Set([
  "admin", "api", "auth", "dashboard", "plexobuilder", "www", "localhost", "dev",
  "test", "prod", "staging", "status", "dns", "mail", "email", "support", "help",
  "static", "assets", "sdk", "pub", "published", "templates", "compile", "settings",
  "profile", "domains", "account", "login", "register", "signup", "logout", "signin"
]);

export function generateDefaultSaaSDesignJson(title: string = "SaaS Product", promptText: string = ""): any {
  const isDark = !promptText.toLowerCase().includes("light");
  const bg = isDark ? "#08090f" : "#ffffff";
  const textColor = isDark ? "#f0f2ff" : "#0f172a";
  const cardBg = isDark ? "#111827" : "#f8fafc";
  const borderColor = isDark ? "rgba(255, 255, 255, 0.08)" : "#e2e8f0";
  const primaryAccent = "#8b5cf6";

  return {
    body: {
      style: {
        backgroundColor: bg,
        color: textColor,
        fontFamily: "Inter, sans-serif",
        padding: "0px",
        margin: "0px",
      },
      rows: [
        // 1. Header / Navbar
        {
          id: "row-nav",
          style: {
            paddingTop: "24px",
            paddingBottom: "24px",
            borderBottom: `1px solid ${borderColor}`,
          },
          columns: [
            {
              id: "col-nav-logo",
              width: "30%",
              elements: [
                {
                  type: "heading",
                  style: { fontSize: "22px", color: primaryAccent, fontWeight: "bold" },
                  attributes: { text: title },
                },
              ],
            },
            {
              id: "col-nav-menu",
              width: "70%",
              elements: [
                {
                  type: "menu",
                  style: { textAlign: "right", color: isDark ? "#a78bfa" : "#6d28d9" },
                  attributes: {
                    links: [
                      { label: "Features", href: "#features" },
                      { label: "Solutions", href: "#solutions" },
                      { label: "Pricing", href: "#pricing" },
                      { label: "Docs", href: "#docs" },
                    ],
                  },
                },
              ],
            },
          ],
        },
        // 2. Hero Section
        {
          id: "row-hero",
          style: {
            paddingTop: "80px",
            paddingBottom: "80px",
            textAlign: "center",
          },
          columns: [
            {
              id: "col-hero-main",
              width: "100%",
              elements: [
                {
                  type: "heading",
                  style: {
                    fontSize: "48px",
                    color: textColor,
                    fontWeight: "800",
                    textAlign: "center",
                    marginBottom: "16px",
                  },
                  attributes: { text: `Build & Scale Faster with ${title}` },
                },
                {
                  type: "paragraph",
                  style: {
                    fontSize: "18px",
                    color: isDark ? "#94a3b8" : "#475569",
                    textAlign: "center",
                    maxWidth: "700px",
                    margin: "0 auto 32px auto",
                  },
                  attributes: {
                    text: promptText || "The AI-native platform built to generate landing pages, automate customer workflows, and scale your product effortlessly.",
                  },
                },
                {
                  type: "button",
                  style: {
                    textAlign: "center",
                    backgroundColor: primaryAccent,
                    color: "#ffffff",
                    borderRadius: "12px",
                    paddingTop: "14px",
                    paddingBottom: "14px",
                    paddingLeft: "28px",
                    paddingRight: "28px",
                    fontSize: "16px",
                    fontWeight: "600",
                  },
                  attributes: { text: "Start Free 14-Day Trial", href: "#signup" },
                },
                {
                  type: "spacer",
                  style: { height: "40px" },
                },
                {
                  type: "image",
                  style: { borderRadius: "16px", borderWidth: "1px", borderColor: borderColor },
                  attributes: {
                    src: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=1200&q=80",
                    alt: "Dashboard Preview",
                  },
                },
              ],
            },
          ],
        },
        // 3. Features Cards
        {
          id: "row-features",
          style: {
            paddingTop: "60px",
            paddingBottom: "60px",
          },
          columns: [
            {
              id: "col-feat-1",
              width: "33.33%",
              elements: [
                {
                  type: "card",
                  style: {
                    backgroundColor: cardBg,
                    borderRadius: "16px",
                    padding: "24px",
                    borderWidth: "1px",
                    borderColor: borderColor,
                  },
                  attributes: {
                    title: "🚀 Lightning Fast Deployment",
                    description: "Publish your pages directly to subdomains with zero infrastructure complexity.",
                  },
                },
              ],
            },
            {
              id: "col-feat-2",
              width: "33.33%",
              elements: [
                {
                  type: "card",
                  style: {
                    backgroundColor: cardBg,
                    borderRadius: "16px",
                    padding: "24px",
                    borderWidth: "1px",
                    borderColor: borderColor,
                  },
                  attributes: {
                    title: "✨ AI Native Builder",
                    description: "Generate pixel-perfect layouts, typography, and responsive sections in seconds.",
                  },
                },
              ],
            },
            {
              id: "col-feat-3",
              width: "33.33%",
              elements: [
                {
                  type: "card",
                  style: {
                    backgroundColor: cardBg,
                    borderRadius: "16px",
                    padding: "24px",
                    borderWidth: "1px",
                    borderColor: borderColor,
                  },
                  attributes: {
                    title: "📊 Real-Time Analytics",
                    description: "Track page views, visitor engagement, and conversion metrics in your dashboard.",
                  },
                },
              ],
            },
          ],
        },
        // 4. CTA Banner
        {
          id: "row-cta",
          style: {
            backgroundColor: isDark ? "rgba(139, 92, 246, 0.12)" : "rgba(139, 92, 246, 0.08)",
            borderRadius: "24px",
            padding: "48px",
            textAlign: "center",
            marginTop: "40px",
            marginBottom: "60px",
            borderWidth: "1px",
            borderColor: "rgba(139, 92, 246, 0.3)",
          },
          columns: [
            {
              id: "col-cta",
              width: "100%",
              elements: [
                {
                  type: "heading",
                  style: { fontSize: "32px", color: textColor, fontWeight: "700", textAlign: "center" },
                  attributes: { text: "Ready to Supercharge Your Growth?" },
                },
                {
                  type: "paragraph",
                  style: { fontSize: "16px", color: isDark ? "#a78bfa" : "#6d28d9", textAlign: "center", marginBottom: "24px" },
                  attributes: { text: "Join thousands of product teams building high-converting sites on Plexo." },
                },
                {
                  type: "button",
                  style: {
                    textAlign: "center",
                    backgroundColor: primaryAccent,
                    color: "#ffffff",
                    borderRadius: "12px",
                    paddingTop: "12px",
                    paddingBottom: "12px",
                    paddingLeft: "24px",
                    paddingRight: "24px",
                    fontWeight: "700",
                  },
                  attributes: { text: "Get Started Now", href: "#signup" },
                },
              ],
            },
          ],
        },
        // 5. Footer
        {
          id: "row-footer",
          style: {
            paddingTop: "32px",
            paddingBottom: "32px",
            borderTop: `1px solid ${borderColor}`,
          },
          columns: [
            {
              id: "col-footer-copy",
              width: "50%",
              elements: [
                {
                  type: "paragraph",
                  style: { fontSize: "13px", color: "#64748b" },
                  attributes: { text: `© ${new Date().getFullYear()} ${title}. All rights reserved.` },
                },
              ],
            },
            {
              id: "col-footer-social",
              width: "50%",
              elements: [
                {
                  type: "social",
                  style: { textAlign: "right", iconColor: "#94a3b8", iconBackgroundColor: "transparent" },
                  attributes: {
                    links: [
                      { provider: "twitter", url: "https://x.com" },
                      { provider: "linkedin", url: "https://linkedin.com" },
                      { provider: "youtube", url: "https://youtube.com" },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

export const PLEXO_MCP_TOOLS = [
  {
    name: "publish_landing_page",
    description:
      "Creates, compiles, and publishes a landing page template (JSON schema and auto-compiled HTML) to a subdomain or custom domain in 1 step.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Title of the landing page (e.g. 'Bulum SaaS')",
        },
        prompt: {
          type: "string",
          description: "Natural language description of the landing page layout, theme, features, and copywriting to generate.",
        },
        designJson: {
          type: "object",
          description: "Plexo layout schema containing body style and rows array.",
          properties: {
            body: {
              type: "object",
              properties: {
                style: {
                  type: "object",
                  description: "Global CSS style properties (backgroundColor, color, fontFamily).",
                },
                rows: {
                  type: "array",
                  description: "Array of layout row objects.",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      style: { type: "object", description: "Row CSS properties." },
                      columns: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            id: { type: "string" },
                            width: { type: "string", description: "Width percentage (e.g. '100%', '50%', '33.33%')." },
                            elements: {
                              type: "array",
                              items: {
                                type: "object",
                                properties: {
                                  type: {
                                    type: "string",
                                    enum: ["heading", "paragraph", "button", "card", "image", "menu", "social", "divider", "spacer", "form_container", "table", "timer", "video"],
                                    description: "Type of component.",
                                  },
                                  style: { type: "object" },
                                  attributes: {
                                    type: "object",
                                    description: "Component attributes (text, title, description, href, src, links, fields).",
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
          description: "Optional pre-compiled HTML. If omitted, Plexo compiles designJson automatically.",
        },
        domain: {
          type: "string",
          description: "Subdomain slug (e.g. 'bulum') or custom domain ('bulum.com')",
        },
        type: {
          type: "string",
          enum: ["SUBDOMAIN", "CUSTOM"],
          description: "Domain routing type (SUBDOMAIN or CUSTOM)",
        },
      },
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
          const promptText = args.prompt?.trim() || "";
          let designJson = args.designJson;

          if (typeof designJson === "string") {
            try {
              designJson = JSON.parse(designJson);
            } catch (e) {
              designJson = null;
            }
          }

          const rows = designJson?.body?.rows || (Array.isArray(designJson?.rows) ? designJson.rows : []);
          if (!rows || rows.length === 0) {
            designJson = generateDefaultSaaSDesignJson(name, promptText);
          } else if (!designJson.body) {
            designJson = {
              body: {
                style: { backgroundColor: "#08090f", color: "#f0f2ff", fontFamily: "Inter, sans-serif" },
                rows,
              },
            };
          }

          let compiledHtml = args.compiledHtml || compileToHTML(designJson);
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

          // Check if domain is already published to this template or another template
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
