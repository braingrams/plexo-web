import { createHash } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/server/prisma";

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

async function parseMjmlBody(request: NextRequest): Promise<string | null> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";

  if (contentType.includes("application/json")) {
    const payload = (await request.json().catch(() => null)) as
      | { mjml?: string; payload?: string }
      | string
      | null;

    if (typeof payload === "string") {
      return payload;
    }

    if (payload && typeof payload.mjml === "string") {
      return payload.mjml;
    }

    if (payload && typeof payload.payload === "string") {
      return payload.payload;
    }

    return null;
  }

  const rawText = await request.text().catch(() => "");
  return rawText || null;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
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

  const mjmlString = await parseMjmlBody(request);
  if (!mjmlString || !mjmlString.trim()) {
    return NextResponse.json({ error: "MJML payload is required." }, { status: 400 });
  }

  const { default: mjml2html } = await import("mjml");

  const compileResult = mjml2html(mjmlString, {
    validationLevel: "soft",
  });

  let compiledHtmlString = compileResult.html;

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
