import { createHash } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/server/prisma";
import { compileToHTML } from "@/lib/compiler";
import { parseJsonToTargetFormat } from "@/lib/compilerClient";
import { TemplateJSONSchema, hydrateStructuralDefaults, formatValidationIssues } from "@/server/sanitizer";

type CompileTargetType = "landing_page" | "email";

type BuilderCompilePayload = {
  targetType?: CompileTargetType;
  template?: any;
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

function isTemplateJson(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "body" in value &&
    typeof (value as any).body === "object" &&
    (value as any).body !== null
  );
}

function isMjml(text: string): boolean {
  const trimmed = text.trim().toLowerCase();
  return trimmed.includes("<mjml") || trimmed.includes("<mj-");
}

async function parseCompileRequest(request: NextRequest): Promise<ParsedCompileRequest | null> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";

  if (contentType.includes("application/json")) {
    const payload = (await request.json().catch(() => null)) as BuilderCompilePayload | string | null;

    if (typeof payload === "string" && payload.trim()) {
      return isMjml(payload) ? { kind: "mjml", mjml: payload } : { kind: "html", html: payload };
    }

    if (!payload || typeof payload !== "object") {
      return null;
    }

    const templateObj = (payload as any).template || (payload as any).designJson || (payload as any).design || (isTemplateJson(payload) ? payload : null);

    if (templateObj) {
      // Same strict schema /api/v1/publish and the MCP tools enforce — reject malformed or
      // shorthand designJson with an actionable error instead of silently compiling it into
      // HTML that looks complete but is missing content.
      const hydrated = hydrateStructuralDefaults(templateObj);
      const validation = TemplateJSONSchema.safeParse(hydrated);
      if (!validation.success) {
        throw new Error(`designJson failed schema validation: ${formatValidationIssues(validation.error)}`);
      }
      const validatedTemplate = validation.data;

      const targetType = (payload as any).targetType === "email" ? "email" : "landing_page";

      if (targetType === "landing_page") {
        return { kind: "html", html: compileToHTML(validatedTemplate) };
      }

      return { kind: "mjml", mjml: parseJsonToTargetFormat(validatedTemplate, "email") };
    }

    if (typeof payload.mjml === "string" && payload.mjml.trim()) {
      return isMjml(payload.mjml) ? { kind: "mjml", mjml: payload.mjml } : { kind: "html", html: payload.mjml };
    }

    if (typeof payload.payload === "string" && payload.payload.trim()) {
      return isMjml(payload.payload) ? { kind: "mjml", mjml: payload.payload } : { kind: "html", html: payload.payload };
    }

    return null;
  }

  const rawText = (await request.text().catch(() => "")).trim();
  if (rawText) {
    return isMjml(rawText) ? { kind: "mjml", mjml: rawText } : { kind: "html", html: rawText };
  }
  return null;
}

async function compileParsedRequest(parsed: ParsedCompileRequest): Promise<{ html: string; errors: string[] }> {
  if (parsed.kind === "html") {
    return { html: parsed.html, errors: [] };
  }

  const { default: mjml2html } = await import("mjml");
  const compileResult = mjml2html(parsed.mjml, { validationLevel: "soft" });
  // "soft" lets compilation proceed despite MJML validation issues (e.g. an unexpected
  // attribute) rather than throwing — surface them as warnings instead of silently
  // discarding, so a design that compiled "successfully" but dropped something isn't a
  // total mystery to the caller.
  const errors = compileResult.errors.map((e) => e.formattedMessage ?? e.message);
  return { html: compileResult.html, errors };
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
    let parsedRequest: ParsedCompileRequest | null;
    try {
      parsedRequest = await parseCompileRequest(clonedRequest);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Malformed template structure." },
        { status: 400 },
      );
    }
    if (!parsedRequest) {
      return NextResponse.json(
        { error: "Compile payload is required (MJML string or builder template JSON)." },
        { status: 400 },
      );
    }

    try {
      const { html, errors } = await compileParsedRequest(parsedRequest);
      return NextResponse.json({ html, errors });
    } catch (err) {
      return NextResponse.json(
        { error: `Compilation failed: ${err instanceof Error ? err.message : 'Malformed template structure'}` },
        { status: 400 }
      );
    }
  }

  // ── Path 2: API key via x-api-key (matches @charisol/plexo-sdk; Bearer kept
  // as a fallback for other callers, same pattern as validate-key/domains) ──
  const rawKey = xApiKey || parseBearerToken(request.headers.get("authorization"));

  if (!rawKey) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const hashedKey = sha256(rawKey);

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

  let parsedRequest: ParsedCompileRequest | null;
  try {
    parsedRequest = await parseCompileRequest(clonedRequest);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Malformed template structure." },
      { status: 400 },
    );
  }
  if (!parsedRequest) {
    return NextResponse.json(
      { error: "Compile payload is required (MJML string or builder template JSON)." },
      { status: 400 },
    );
  }

  let compiledHtmlString: string;
  let compileErrors: string[];
  try {
    ({ html: compiledHtmlString, errors: compileErrors } = await compileParsedRequest(parsedRequest));
  } catch (err) {
    return NextResponse.json(
      { error: `Compilation failed: ${err instanceof Error ? err.message : 'Malformed template structure'}` },
      { status: 400 }
    );
  }

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
    errors: compileErrors,
  });
}

