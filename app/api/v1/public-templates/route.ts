import { createHash } from "node:crypto";
import { TemplateKind } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

// High quality default public templates served by Plexo Web when requested by clients
const DEFAULT_PUBLIC_TEMPLATES = [
  {
    id: "plexo-pub-lp-1",
    name: "Modern SaaS Landing Page",
    kind: "LANDING_PAGE" as const,
    category: "landing-page",
    previewImage: "https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=600&q=80",
    designJson: {
      version: 1,
      body: {
        style: { background: "#0f172a", color: "#f8fafc", padding: "40px 20px" },
        rows: [
          {
            id: "row-hero",
            cells: [12],
            columns: [
              {
                components: [
                  {
                    id: "comp-badge",
                    type: "text",
                    content: "<span style='background:rgba(59,130,246,0.2); color:#60a5fa; padding:4px 12px; border-radius:9999px; font-size:12px; font-weight:600;'>🚀 NEW RELEASE</span>"
                  },
                  {
                    id: "comp-headline",
                    type: "heading",
                    content: "<h1 style='font-size:42px; font-weight:800; color:#ffffff; margin-top:16px;'>Build Faster with Plexo</h1>"
                  },
                  {
                    id: "comp-subhead",
                    type: "text",
                    content: "<p style='font-size:18px; color:#94a3b8; margin-top:12px;'>The visual design engine for email campaigns and high-converting landing pages.</p>"
                  },
                  {
                    id: "comp-cta",
                    type: "button",
                    content: "<a href='#' style='display:inline-block; background:#3b82f6; color:#ffffff; padding:12px 28px; border-radius:8px; font-weight:600; text-decoration:none; margin-top:24px;'>Get Started Free</a>"
                  }
                ]
              }
            ]
          }
        ]
      }
    },
    compiledHtml: "<div style='background:#0f172a; color:#f8fafc; padding:40px 20px; text-align:center;'><h1>Build Faster with Plexo</h1><p>The visual design engine for email campaigns and high-converting landing pages.</p></div>",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: "plexo-pub-opt-1",
    name: "Clean Lead Magnet Form",
    kind: "LANDING_PAGE" as const,
    category: "opt-in-page",
    previewImage: "https://images.unsplash.com/photo-1557804506-669a67965ba0?auto=format&fit=crop&w=600&q=80",
    designJson: {
      version: 1,
      body: {
        style: { background: "#ffffff", color: "#1e293b", padding: "32px 16px" },
        rows: [
          {
            id: "row-optin",
            cells: [12],
            columns: [
              {
                components: [
                  {
                    id: "comp-optin-title",
                    type: "heading",
                    content: "<h2 style='font-size:28px; font-weight:700; color:#0f172a;'>Subscribe to our Newsletter</h2>"
                  },
                  {
                    id: "comp-optin-desc",
                    type: "text",
                    content: "<p style='color:#64748b; margin-top:8px;'>Get the latest product updates and industry insights straight to your inbox.</p>"
                  }
                ]
              }
            ]
          }
        ]
      }
    },
    compiledHtml: "<div style='padding:32px; text-align:center;'><h2>Subscribe to our Newsletter</h2><p>Get the latest product updates and industry insights straight to your inbox.</p></div>",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: "plexo-pub-email-1",
    name: "Product Announcement Email",
    kind: "EMAIL" as const,
    category: "email",
    previewImage: "https://images.unsplash.com/photo-1563986768609-322da13575f3?auto=format&fit=crop&w=600&q=80",
    designJson: {
      version: 1,
      body: {
        style: { background: "#f8fafc", padding: "24px" },
        rows: [
          {
            id: "email-row-1",
            cells: [12],
            columns: [
              {
                components: [
                  {
                    id: "email-header",
                    type: "text",
                    content: "<h2 style='color:#2563eb;'>Introducing Our New Features</h2>"
                  },
                  {
                    id: "email-body",
                    type: "text",
                    content: "<p style='color:#334155; font-size:15px;'>We are thrilled to launch our latest tools designed to supercharge your workflow.</p>"
                  },
                  {
                    id: "email-cta",
                    type: "button",
                    content: "<a href='#' style='background:#2563eb; color:#ffffff; padding:10px 20px; border-radius:6px; text-decoration:none;'>Try It Today</a>"
                  }
                ]
              }
            ]
          }
        ]
      }
    },
    compiledHtml: "<div style='background:#f8fafc; padding:24px;'><h2 style='color:#2563eb;'>Introducing Our New Features</h2><p>We are thrilled to launch our latest tools designed to supercharge your workflow.</p></div>",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
];

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const rawApiKey =
      request.headers.get("x-api-key")?.trim() ||
      request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();

    // This previously logged that a key was present without ever validating it or scoping
    // the DB query below by its owner — every caller (regardless of whose key they sent, or
    // even with no key at all) got every user's saved templates in the entire database, not
    // just their own. A key is required: this endpoint returns DB-backed user templates
    // alongside the hardcoded public samples, and there's no legitimate "anonymous, see
    // everyone's templates" use case for it.
    if (!rawApiKey) {
      return NextResponse.json({ error: "An API key is required (x-api-key or Authorization: Bearer)." }, { status: 401 });
    }

    const hashedKey = sha256(rawApiKey);
    const apiKeyRecord = await prisma.apiKey.findFirst({
      where: { hashedKey, isActive: true },
      select: { id: true, userId: true },
    });

    if (!apiKeyRecord) {
      return NextResponse.json({ error: "Invalid or inactive API key." }, { status: 401 });
    }

    const ownerUserId = apiKeyRecord.userId;

    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category"); // "landing-page" | "opt-in-page" | "email"
    const kindParam = searchParams.get("kind"); // "LANDING_PAGE" | "EMAIL"
    const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 100);
    const skip = parseInt(searchParams.get("skip") || "0", 10);

    let targetKind: TemplateKind | null = null;
    if (kindParam === "LANDING_PAGE" || kindParam === "EMAIL") {
      targetKind = kindParam as TemplateKind;
    } else if (category === "landing-page" || category === "opt-in-page") {
      targetKind = TemplateKind.LANDING_PAGE;
    } else if (category === "email") {
      targetKind = TemplateKind.EMAIL;
    }

    // Query DB for templates with no parentId (root pages), scoped to the authenticated
    // key's own owner — this previously had no userId filter at all, so every request
    // returned every user's saved templates across the entire platform.
    const dbWhere: any = { parentId: null, userId: ownerUserId };
    if (targetKind) {
      dbWhere.kind = targetKind;
    }

    let dbTemplates: Array<any> = [];
    try {
      dbTemplates = await prisma.template.findMany({
        where: dbWhere,
        orderBy: { updatedAt: "desc" },
        take: limit,
        skip: skip,
        select: {
          id: true,
          name: true,
          kind: true,
          designJson: true,
          compiledHtml: true,
          createdAt: true,
          updatedAt: true
        }
      });
    } catch (dbErr) {
      console.warn("[Plexo Web] DB query for public templates warning:", dbErr);
    }

    const formattedDbTemplates = dbTemplates.map((t) => ({
      id: t.id,
      name: t.name,
      kind: t.kind,
      category: t.kind === TemplateKind.LANDING_PAGE ? (category || "landing-page") : "email",
      previewImage: null,
      designJson: t.designJson,
      compiledHtml: t.compiledHtml,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString()
    }));

    // Filter defaults based on requested category/kind
    const filteredDefaults = DEFAULT_PUBLIC_TEMPLATES.filter((tpl) => {
      if (category && tpl.category !== category) {
        if (category === "landing-page" && tpl.category !== "landing-page") return false;
        if (category === "opt-in-page" && tpl.category !== "opt-in-page") return false;
        if (category === "email" && tpl.category !== "email") return false;
      }
      if (targetKind && tpl.kind !== targetKind) return false;
      return true;
    });

    const combined = [...formattedDbTemplates, ...filteredDefaults].slice(skip, skip + limit);

    return NextResponse.json({
      success: true,
      templates: combined,
      total: combined.length
    });
  } catch (error: any) {
    console.error("[Plexo Web Public Templates Error]:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch public templates" }, { status: 500 });
  }
}
