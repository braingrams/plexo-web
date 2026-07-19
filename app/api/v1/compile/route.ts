import { createHash } from "node:crypto";

import { compileToHTML, parseJsonToTargetFormat, type TemplateJSON } from "@plexobuilder/sdk";
import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/server/prisma";

type CompileTargetType = "landing_page" | "email";

type BuilderCompilePayload = {
  targetType?: CompileTargetType;
  template?: TemplateJSON;
  source?: string;
  mjml?: string;
  payload?: string;
};

type ParsedCompileRequest =
  | { kind: "html"; html: string }
  | { kind: "mjml"; mjml: string };

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function parseBearerToken(authorization: string | null): string | null {
  if (!authorization) {
    return null;
  }

  const [scheme, token] = authorization.split(" ");
  if (!scheme || !token) {
    return null;
  }

  if (scheme.toLowerCase() !== "bearer") {
    return null;
  }

  const trimmedToken = token.trim();
  return trimmedToken ? trimmedToken : null;
}

function providerLabel(model: string): string {
  const normalized = model.toLowerCase();

  if (normalized === "anthropic_claude" || normalized.includes("claude")) {
    return "Anthropic/Claude";
  }

  if (normalized === "google_gemini" || normalized.includes("gemini")) {
    return "Google Gemini";
  }

  if (normalized.includes("openai") || normalized.includes("gpt")) {
    return "OpenAI";
  }

  return model;
}

function tierLabel(tier: "AUTO" | "BASIC" | "MEDIUM" | "HIGH"): string {
  switch (tier) {
    case "BASIC":
      return "Basic";
    case "MEDIUM":
      return "Medium";
    case "HIGH":
      return "High";
    case "AUTO":
    default:
      return "Auto";
  }
}

function isTemplateJson(value: unknown): value is TemplateJSON {
  return (
    typeof value === "object" &&
    value !== null &&
    "body" in value &&
    typeof (value as TemplateJSON).body === "object" &&
    (value as TemplateJSON).body !== null
  );
}

async function parseCompileRequest(request: NextRequest): Promise<ParsedCompileRequest | null> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";

  if (contentType.includes("application/json")) {
    const payload = (await request.json().catch(() => null)) as BuilderCompilePayload | string | null;

    if (typeof payload === "string" && payload.trim()) {
      return { kind: "mjml", mjml: payload };
    }

    if (!payload || typeof payload !== "object") {
      return null;
    }

    if (isTemplateJson(payload.template)) {
      const targetType = payload.targetType === "email" ? "email" : "landing_page";

      if (targetType === "landing_page") {
        return { kind: "html", html: compileToHTML(payload.template) };
      }

      return { kind: "mjml", mjml: parseJsonToTargetFormat(payload.template, "email") };
    }

    if (typeof payload.mjml === "string" && payload.mjml.trim()) {
      return { kind: "mjml", mjml: payload.mjml };
    }

    if (typeof payload.payload === "string" && payload.payload.trim()) {
      return { kind: "mjml", mjml: payload.payload };
    }

    return null;
  }

  const rawText = (await request.text().catch(() => "")).trim();
  return rawText ? { kind: "mjml", mjml: rawText } : null;
}

async function compileParsedRequest(parsed: ParsedCompileRequest): Promise<string> {
  if (parsed.kind === "html") {
    return parsed.html;
  }

  const { default: mjml2html } = await import("mjml");
  const compileResult = mjml2html(parsed.mjml, { validationLevel: "soft" });
  return compileResult.html;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Clone request before consuming body (body can only be read once)
  const clonedRequest = request.clone() as NextRequest;

  // ── Path 1: workspace-internal (dashboard session) ──────────────────────
  const xApiKey = request.headers.get("x-api-key")?.trim();
  if (xApiKey === "workspace-internal") {
    const { auth } = await import("@/server/auth");
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // Allow compile without a real API key record
    const parsedRequest = await parseCompileRequest(clonedRequest);
    if (!parsedRequest) {
      return NextResponse.json(
        { error: "Compile payload is required (MJML string or builder template JSON)." },
        { status: 400 },
      );
    }

    const html = await compileParsedRequest(parsedRequest);
    return NextResponse.json({ html, errors: [] });
  }

  // ── Path 2: API key via Bearer token ────────────────────────────────────
  const bearerToken = parseBearerToken(request.headers.get("authorization"));

  if (!bearerToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const hashedKey = sha256(bearerToken);

  const apiKey = await prisma.apiKey.findFirst({
    where: {
      hashedKey,
      isActive: true,
    },
    select: {
      id: true,
      useAi: true,
      aiProvider: true,
      aiTier: true,
    },
  });

  if (!apiKey) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsedRequest = await parseCompileRequest(clonedRequest);
  if (!parsedRequest) {
    return NextResponse.json(
      { error: "Compile payload is required (MJML string or builder template JSON)." },
      { status: 400 },
    );
  }

  let compiledHtmlString = await compileParsedRequest(parsedRequest);

  if (apiKey.useAi) {
    const signature = `<!-- Optimized via Plexo AI Proxy Provider: ${providerLabel(apiKey.aiProvider)} | Tier: ${tierLabel(apiKey.aiTier)} -->`;
    compiledHtmlString = `${compiledHtmlString}\n${signature}`;
  }

  await prisma.apiKey.update({
    where: { id: apiKey.id },
    data: { lastUsedAt: new Date() },
  });

  return NextResponse.json({
    html: compiledHtmlString,
    errors: [],
  });
}
