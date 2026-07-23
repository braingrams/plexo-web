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

/**
 * Production-Grade Universal Multi-Category Layout Synthesizer
 * Supports E-Commerce, Portfolio/Agency, Restaurant, Healthcare, SaaS/Tech, and Custom Prompts.
 */
export function synthesizeLayoutFromPrompt(title: string = "Plexo Page", promptText: string = ""): any {
  const lowerPrompt = promptText.toLowerCase();
  const lowerTitle = title.toLowerCase();
  const combinedText = `${lowerTitle} ${lowerPrompt}`;

  const isDark = !lowerPrompt.includes("light") && (lowerPrompt.includes("dark") || lowerPrompt.includes("black") || lowerPrompt.includes("neon") || lowerPrompt.includes("saas"));
  const bg = isDark ? "#08090f" : "#ffffff";
  const textColor = isDark ? "#f0f2ff" : "#0f172a";
  const cardBg = isDark ? "#111827" : "#f8fafc";
  const borderColor = isDark ? "rgba(255, 255, 255, 0.08)" : "#e2e8f0";
  const primaryAccent = "#8b5cf6";

  // Category Detection
  const isEcommerce = /e-?commerce|store|product|shop|shoe|sneaker|fashion|apparel|boutique|price|cart|buy/i.test(combinedText);
  const isPortfolio = /portfolio|developer|designer|agency|freelance|studio|creator|work|cv|resume/i.test(combinedText);
  const isRestaurant = /restaurant|food|cafe|dining|menu|chef|bakery|pizza|bistro|reservation|table/i.test(combinedText);
  const isHealthcare = /clinic|health|medical|doctor|wellness|fitness|dental|hospital|care/i.test(combinedText);

  // 1. E-COMMERCE LAYOUT
  if (isEcommerce) {
    return {
      body: {
        style: { backgroundColor: bg, color: textColor, fontFamily: "Inter, sans-serif", padding: "0px", margin: "0px" },
        rows: [
          {
            id: "row-nav",
            style: { paddingTop: "20px", paddingBottom: "20px", borderBottom: `1px solid ${borderColor}` },
            columns: [
              {
                id: "col-logo",
                width: "30%",
                elements: [{ type: "heading", style: { fontSize: "24px", color: primaryAccent, fontWeight: "bold" }, attributes: { text: title } }],
              },
              {
                id: "col-menu",
                width: "70%",
                elements: [
                  {
                    type: "menu",
                    style: { textAlign: "right", color: isDark ? "#a78bfa" : "#6d28d9" },
                    attributes: {
                      links: [
                        { label: "New Arrivals", href: "#new" },
                        { label: "Best Sellers", href: "#bestsellers" },
                        { label: "Collections", href: "#collections" },
                        { label: "Contact", href: "#contact" },
                      ],
                    },
                  },
                ],
              },
            ],
          },
          {
            id: "row-hero",
            style: { paddingTop: "60px", paddingBottom: "60px", textAlign: "center" },
            columns: [
              {
                id: "col-hero-left",
                width: "50%",
                elements: [
                  { type: "heading", style: { fontSize: "42px", color: textColor, fontWeight: "800", marginBottom: "16px" }, attributes: { text: `Exclusive Collection: ${title}` } },
                  { type: "paragraph", style: { fontSize: "16px", color: isDark ? "#94a3b8" : "#475569", marginBottom: "24px" }, attributes: { text: promptText || "Premium craftsmanship meets modern design. Discover top-tier quality crafted for performance and elegance." } },
                  { type: "button", style: { backgroundColor: primaryAccent, color: "#ffffff", borderRadius: "12px", paddingTop: "14px", paddingBottom: "14px", paddingLeft: "28px", paddingRight: "28px", fontSize: "16px", fontWeight: "600" }, attributes: { text: "Shop New Collection", href: "#products" } },
                ],
              },
              {
                id: "col-hero-right",
                width: "50%",
                elements: [
                  { type: "image", style: { borderRadius: "20px", width: "100%" }, attributes: { src: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=800&q=80", alt: "Featured Product" } },
                ],
              },
            ],
          },
          {
            id: "row-products",
            style: { paddingTop: "60px", paddingBottom: "60px" },
            columns: [
              {
                id: "p1",
                width: "33.33%",
                elements: [
                  { type: "image", style: { borderRadius: "12px" }, attributes: { src: "https://images.unsplash.com/photo-1552346154-21d32810aba3?auto=format&fit=crop&w=600&q=80", alt: "Item 1" } },
                  { type: "card", style: { backgroundColor: cardBg, borderRadius: "12px", padding: "16px", marginTop: "12px", borderColor }, attributes: { title: "Edition Pro - $189", description: "Ultralight breathable materials with responsive cushioning." } },
                  { type: "button", style: { backgroundColor: isDark ? "#3b82f6" : "#2563eb", color: "#fff", borderRadius: "8px", paddingTop: "8px", paddingBottom: "8px", marginTop: "8px" }, attributes: { text: "Add to Cart", href: "#cart" } },
                ],
              },
              {
                id: "p2",
                width: "33.33%",
                elements: [
                  { type: "image", style: { borderRadius: "12px" }, attributes: { src: "https://images.unsplash.com/photo-1595950653106-6c9ebd614d3a?auto=format&fit=crop&w=600&q=80", alt: "Item 2" } },
                  { type: "card", style: { backgroundColor: cardBg, borderRadius: "12px", padding: "16px", marginTop: "12px", borderColor }, attributes: { title: "Urban Street - $149", description: "Sleek monochromatic silhouette built for modern street style." } },
                  { type: "button", style: { backgroundColor: isDark ? "#3b82f6" : "#2563eb", color: "#fff", borderRadius: "8px", paddingTop: "8px", paddingBottom: "8px", marginTop: "8px" }, attributes: { text: "Add to Cart", href: "#cart" } },
                ],
              },
              {
                id: "p3",
                width: "33.33%",
                elements: [
                  { type: "image", style: { borderRadius: "12px" }, attributes: { src: "https://images.unsplash.com/photo-1608231387042-66d1773070a5?auto=format&fit=crop&w=600&q=80", alt: "Item 3" } },
                  { type: "card", style: { backgroundColor: cardBg, borderRadius: "12px", padding: "16px", marginTop: "12px", borderColor }, attributes: { title: "Classic Heritage - $210", description: "Handcrafted full-grain leather finish with reinforced sole." } },
                  { type: "button", style: { backgroundColor: isDark ? "#3b82f6" : "#2563eb", color: "#fff", borderRadius: "8px", paddingTop: "8px", paddingBottom: "8px", marginTop: "8px" }, attributes: { text: "Add to Cart", href: "#cart" } },
                ],
              },
            ],
          },
          {
            id: "row-footer",
            style: { paddingTop: "32px", paddingBottom: "32px", borderTop: `1px solid ${borderColor}` },
            columns: [
              { id: "f1", width: "50%", elements: [{ type: "paragraph", style: { fontSize: "13px", color: "#64748b" }, attributes: { text: `© ${new Date().getFullYear()} ${title} Store. All rights reserved.` } }] },
              { id: "f2", width: "50%", elements: [{ type: "social", style: { textAlign: "right", iconColor: "#94a3b8" }, attributes: { links: [{ provider: "instagram", url: "https://instagram.com" }, { provider: "twitter", url: "https://x.com" }, { provider: "facebook", url: "https://facebook.com" }] } }] },
            ],
          },
        ],
      },
    };
  }

  // 2. PORTFOLIO / AGENCY LAYOUT
  if (isPortfolio) {
    return {
      body: {
        style: { backgroundColor: bg, color: textColor, fontFamily: "Inter, sans-serif", padding: "0px", margin: "0px" },
        rows: [
          {
            id: "row-nav",
            style: { paddingTop: "20px", paddingBottom: "20px", borderBottom: `1px solid ${borderColor}` },
            columns: [
              { id: "c1", width: "30%", elements: [{ type: "heading", style: { fontSize: "22px", color: primaryAccent, fontWeight: "bold" }, attributes: { text: title } }] },
              { id: "c2", width: "70%", elements: [{ type: "menu", style: { textAlign: "right", color: isDark ? "#a78bfa" : "#6d28d9" }, attributes: { links: [{ label: "About", href: "#about" }, { label: "Work", href: "#work" }, { label: "Services", href: "#services" }, { label: "Contact", href: "#contact" }] } }] },
            ],
          },
          {
            id: "row-hero",
            style: { paddingTop: "70px", paddingBottom: "70px" },
            columns: [
              {
                id: "c-left",
                width: "60%",
                elements: [
                  { type: "heading", style: { fontSize: "44px", color: textColor, fontWeight: "800", marginBottom: "16px" }, attributes: { text: `Crafting Extraordinary Digital Experiences.` } },
                  { type: "paragraph", style: { fontSize: "18px", color: isDark ? "#94a3b8" : "#475569", marginBottom: "28px" }, attributes: { text: promptText || "Senior product designer & developer specializing in web applications, design systems, and high-performance user interfaces." } },
                  { type: "button", style: { backgroundColor: primaryAccent, color: "#ffffff", borderRadius: "10px", paddingTop: "12px", paddingBottom: "12px", paddingLeft: "24px", paddingRight: "24px" }, attributes: { text: "View Featured Projects", href: "#work" } },
                ],
              },
              {
                id: "c-right",
                width: "40%",
                elements: [
                  { type: "image", style: { borderRadius: "20px", width: "100%" }, attributes: { src: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=600&q=80", alt: "Creator Portrait" } },
                ],
              },
            ],
          },
          {
            id: "row-services",
            style: { paddingTop: "40px", paddingBottom: "60px" },
            columns: [
              { id: "s1", width: "33.33%", elements: [{ type: "card", style: { backgroundColor: cardBg, borderRadius: "14px", padding: "20px", borderColor }, attributes: { title: "🎨 UI/UX & Web Design", description: "Responsive interface architecture, visual identity, and interactive prototypes." } }] },
              { id: "s2", width: "33.33%", elements: [{ type: "card", style: { backgroundColor: cardBg, borderRadius: "14px", padding: "20px", borderColor }, attributes: { title: "⚡ Full-Stack Development", description: "Scalable frontend frameworks, serverless APIs, and database engineering." } }] },
              { id: "s3", width: "33.33%", elements: [{ type: "card", style: { backgroundColor: cardBg, borderRadius: "14px", padding: "20px", borderColor }, attributes: { title: "🚀 Product Strategy", description: "Go-to-market architecture, performance optimization, and SEO growth." } }] },
            ],
          },
          {
            id: "row-contact",
            style: { paddingTop: "50px", paddingBottom: "50px", backgroundColor: isDark ? "#111827" : "#f1f5f9", borderRadius: "20px", padding: "40px", marginBottom: "40px" },
            columns: [
              {
                id: "c-form",
                width: "100%",
                elements: [
                  { type: "heading", style: { fontSize: "28px", color: textColor, textAlign: "center", marginBottom: "16px" }, attributes: { text: "Have a Project in Mind?" } },
                  {
                    type: "form_container",
                    style: { backgroundColor: bg, borderRadius: "16px", padding: "24px", borderColor },
                    attributes: {
                      submitLabel: "Send Message",
                      fields: [
                        { name: "name", label: "Your Name", kind: "text", required: true },
                        { name: "email", label: "Email Address", kind: "email", required: true },
                        { name: "message", label: "Project Details", kind: "textarea", required: true },
                      ],
                    },
                  },
                ],
              },
            ],
          },
          {
            id: "row-footer",
            style: { paddingTop: "30px", paddingBottom: "30px", borderTop: `1px solid ${borderColor}` },
            columns: [
              { id: "f1", width: "50%", elements: [{ type: "paragraph", style: { fontSize: "13px", color: "#64748b" }, attributes: { text: `© ${new Date().getFullYear()} ${title}. All rights reserved.` } }] },
              { id: "f2", width: "50%", elements: [{ type: "social", style: { textAlign: "right", iconColor: "#94a3b8" }, attributes: { links: [{ provider: "linkedin", url: "https://linkedin.com" }, { provider: "github", url: "https://github.com" }, { provider: "x", url: "https://x.com" }] } }] },
            ],
          },
        ],
      },
    };
  }

  // 3. RESTAURANT / HOSPITALITY LAYOUT
  if (isRestaurant) {
    return {
      body: {
        style: { backgroundColor: bg, color: textColor, fontFamily: "Inter, sans-serif", padding: "0px", margin: "0px" },
        rows: [
          {
            id: "row-nav",
            style: { paddingTop: "20px", paddingBottom: "20px", borderBottom: `1px solid ${borderColor}` },
            columns: [
              { id: "c1", width: "30%", elements: [{ type: "heading", style: { fontSize: "24px", color: "#f59e0b", fontWeight: "bold" }, attributes: { text: title } }] },
              { id: "c2", width: "70%", elements: [{ type: "menu", style: { textAlign: "right", color: isDark ? "#fcd34d" : "#b45309" }, attributes: { links: [{ label: "Menu", href: "#menu" }, { label: "Chef's Specials", href: "#specials" }, { label: "Reservations", href: "#book" }] } }] },
            ],
          },
          {
            id: "row-hero",
            style: { paddingTop: "70px", paddingBottom: "70px", textAlign: "center" },
            columns: [
              {
                id: "c-main",
                width: "100%",
                elements: [
                  { type: "heading", style: { fontSize: "46px", color: textColor, fontWeight: "800", marginBottom: "16px" }, attributes: { text: `Artisanal Culinary Excellence at ${title}` } },
                  { type: "paragraph", style: { fontSize: "18px", color: isDark ? "#94a3b8" : "#475569", maxWidth: "680px", margin: "0 auto 28px auto" }, attributes: { text: promptText || "Locally sourced ingredients, wood-fired flavors, and handcrafted cocktails served in an extraordinary atmosphere." } },
                  { type: "button", style: { backgroundColor: "#f59e0b", color: "#ffffff", borderRadius: "12px", paddingTop: "14px", paddingBottom: "14px", paddingLeft: "28px", paddingRight: "28px", fontSize: "16px", fontWeight: "700" }, attributes: { text: "Reserve Your Table", href: "#book" } },
                  { type: "spacer", style: { height: "30px" } },
                  { type: "image", style: { borderRadius: "20px", width: "100%" }, attributes: { src: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1200&q=80", alt: "Dining Room" } },
                ],
              },
            ],
          },
          {
            id: "row-booking",
            style: { paddingTop: "40px", paddingBottom: "50px" },
            columns: [
              {
                id: "c-res",
                width: "100%",
                elements: [
                  { type: "heading", style: { fontSize: "28px", color: textColor, textAlign: "center", marginBottom: "16px" }, attributes: { text: "Book a Table Online" } },
                  {
                    type: "form_container",
                    style: { backgroundColor: cardBg, borderRadius: "16px", padding: "24px", borderColor },
                    attributes: {
                      submitLabel: "Confirm Reservation",
                      fields: [
                        { name: "name", label: "Full Name", kind: "text", required: true },
                        { name: "guests", label: "Party Size", kind: "select", options: [{ label: "2 Guests", value: "2" }, { label: "4 Guests", value: "4" }, { label: "6+ Guests", value: "6+" }], required: true },
                        { name: "date", label: "Preferred Date & Time", kind: "text", placeholder: "e.g. Tomorrow at 7:30 PM", required: true },
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

  // 4. HEALTHCARE / WELLNESS LAYOUT
  if (isHealthcare) {
    return {
      body: {
        style: { backgroundColor: bg, color: textColor, fontFamily: "Inter, sans-serif", padding: "0px", margin: "0px" },
        rows: [
          {
            id: "row-nav",
            style: { paddingTop: "20px", paddingBottom: "20px", borderBottom: `1px solid ${borderColor}` },
            columns: [
              { id: "c1", width: "30%", elements: [{ type: "heading", style: { fontSize: "24px", color: "#10b981", fontWeight: "bold" }, attributes: { text: title } }] },
              { id: "c2", width: "70%", elements: [{ type: "menu", style: { textAlign: "right", color: "#059669" }, attributes: { links: [{ label: "Services", href: "#services" }, { label: "Specialists", href: "#doctors" }, { label: "Appointments", href: "#book" }] } }] },
            ],
          },
          {
            id: "row-hero",
            style: { paddingTop: "70px", paddingBottom: "70px" },
            columns: [
              {
                id: "c-left",
                width: "55%",
                elements: [
                  { type: "heading", style: { fontSize: "44px", color: textColor, fontWeight: "800", marginBottom: "16px" }, attributes: { text: `Compassionate, Advanced Care at ${title}` } },
                  { type: "paragraph", style: { fontSize: "18px", color: isDark ? "#94a3b8" : "#475569", marginBottom: "28px" }, attributes: { text: promptText || "Board-certified specialists dedicated to personal wellness, preventive medicine, and comprehensive healthcare." } },
                  { type: "button", style: { backgroundColor: "#10b981", color: "#ffffff", borderRadius: "12px", paddingTop: "14px", paddingBottom: "14px", paddingLeft: "28px", paddingRight: "28px", fontSize: "16px", fontWeight: "600" }, attributes: { text: "Request Appointment", href: "#book" } },
                ],
              },
              {
                id: "c-right",
                width: "45%",
                elements: [
                  { type: "image", style: { borderRadius: "20px", width: "100%" }, attributes: { src: "https://images.unsplash.com/photo-1629909613654-28e377c37b09?auto=format&fit=crop&w=800&q=80", alt: "Medical Clinic" } },
                ],
              },
            ],
          },
        ],
      },
    };
  }

  // 5. DEFAULT / SAAS & TECH LAYOUT (Fallback)
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
        {
          id: "row-nav",
          style: { paddingTop: "24px", paddingBottom: "24px", borderBottom: `1px solid ${borderColor}` },
          columns: [
            { id: "col-logo", width: "30%", elements: [{ type: "heading", style: { fontSize: "22px", color: primaryAccent, fontWeight: "bold" }, attributes: { text: title } }] },
            { id: "col-menu", width: "70%", elements: [{ type: "menu", style: { textAlign: "right", color: isDark ? "#a78bfa" : "#6d28d9" }, attributes: { links: [{ label: "Features", href: "#features" }, { label: "Solutions", href: "#solutions" }, { label: "Pricing", href: "#pricing" }, { label: "Docs", href: "#docs" }] } }] },
          ],
        },
        {
          id: "row-hero",
          style: { paddingTop: "80px", paddingBottom: "80px", textAlign: "center" },
          columns: [
            {
              id: "col-hero-main",
              width: "100%",
              elements: [
                { type: "heading", style: { fontSize: "48px", color: textColor, fontWeight: "800", textAlign: "center", marginBottom: "16px" }, attributes: { text: `Build & Scale Faster with ${title}` } },
                { type: "paragraph", style: { fontSize: "18px", color: isDark ? "#94a3b8" : "#475569", textAlign: "center", maxWidth: "700px", margin: "0 auto 32px auto" }, attributes: { text: promptText || "The AI-native platform built to generate landing pages, automate customer workflows, and scale your product effortlessly." } },
                { type: "button", style: { textAlign: "center", backgroundColor: primaryAccent, color: "#ffffff", borderRadius: "12px", paddingTop: "14px", paddingBottom: "14px", paddingLeft: "28px", paddingRight: "28px", fontSize: "16px", fontWeight: "600" }, attributes: { text: "Start Free 14-Day Trial", href: "#signup" } },
                { type: "spacer", style: { height: "40px" } },
                { type: "image", style: { borderRadius: "16px", borderWidth: "1px", borderColor: borderColor }, attributes: { src: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=1200&q=80", alt: "Dashboard Preview" } },
              ],
            },
          ],
        },
        {
          id: "row-features",
          style: { paddingTop: "60px", paddingBottom: "60px" },
          columns: [
            { id: "f1", width: "33.33%", elements: [{ type: "card", style: { backgroundColor: cardBg, borderRadius: "16px", padding: "24px", borderWidth: "1px", borderColor }, attributes: { title: "🚀 Lightning Fast Deployment", description: "Publish your pages directly to subdomains with zero infrastructure complexity." } }] },
            { id: "f2", width: "33.33%", elements: [{ type: "card", style: { backgroundColor: cardBg, borderRadius: "16px", padding: "24px", borderWidth: "1px", borderColor }, attributes: { title: "✨ AI Native Builder", description: "Generate pixel-perfect layouts, typography, and responsive sections in seconds." } }] },
            { id: "f3", width: "33.33%", elements: [{ type: "card", style: { backgroundColor: cardBg, borderRadius: "16px", padding: "24px", borderWidth: "1px", borderColor }, attributes: { title: "📊 Real-Time Analytics", description: "Track page views, visitor engagement, and conversion metrics in your dashboard." } }] },
          ],
        },
        {
          id: "row-footer",
          style: { paddingTop: "32px", paddingBottom: "32px", borderTop: `1px solid ${borderColor}` },
          columns: [
            { id: "c1", width: "50%", elements: [{ type: "paragraph", style: { fontSize: "13px", color: "#64748b" }, attributes: { text: `© ${new Date().getFullYear()} ${title}. All rights reserved.` } }] },
            { id: "c2", width: "50%", elements: [{ type: "social", style: { textAlign: "right", iconColor: "#94a3b8" }, attributes: { links: [{ provider: "twitter", url: "https://x.com" }, { provider: "linkedin", url: "https://linkedin.com" }, { provider: "youtube", url: "https://youtube.com" }] } }] },
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
      "Creates, compiles, and publishes a landing page template to a subdomain or custom domain in 1 step. Supports E-commerce, Portfolios, Restaurants, Healthcare, SaaS, and any custom landing page prompt.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Title or brand name of the landing page (e.g. 'Kicks Store', 'Bulum SaaS', 'Dr. Smith Clinic')",
        },
        prompt: {
          type: "string",
          description: "Full natural language description of the page content, theme, category, copywriting, and sections to build.",
        },
        designJson: {
          type: "object",
          description: "Optional complete or partial Plexo layout schema object containing body style and rows array.",
          properties: {
            body: {
              type: "object",
              properties: {
                style: { type: "object", description: "Global CSS style (backgroundColor, color, fontFamily)." },
                rows: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      style: { type: "object" },
                      columns: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            id: { type: "string" },
                            width: { type: "string", description: "Percentage width (e.g. '100%', '50%', '33.33%')." },
                            elements: {
                              type: "array",
                              items: {
                                type: "object",
                                properties: {
                                  type: {
                                    type: "string",
                                    enum: ["heading", "paragraph", "button", "card", "image", "menu", "social", "divider", "spacer", "form_container", "table", "timer", "video"],
                                  },
                                  style: { type: "object" },
                                  attributes: { type: "object" },
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
          description: "Optional pre-compiled HTML.",
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
    },
  },
  {
    name: "create_email_template",
    description: "Creates and saves a responsive HTML email template for newsletters, transactional emails, or promotional campaigns.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Subject line or template title (e.g. 'Weekly Newsletter #42')",
        },
        prompt: {
          type: "string",
          description: "Natural language description of the email content, call to action, and design theme.",
        },
        designJson: {
          type: "object",
          description: "Optional email layout schema.",
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
            designJson = synthesizeLayoutFromPrompt(name, promptText);
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
          const promptText = args.prompt?.trim() || "";
          let designJson = args.designJson || synthesizeLayoutFromPrompt(name, promptText);

          let compiledHtml = compileToHTML(designJson);
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
