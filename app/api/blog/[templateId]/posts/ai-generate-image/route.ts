import { NextRequest, NextResponse } from "next/server";
import { put, BlobError } from "@vercel/blob";

import { resolveBlogAdminSite } from "@/lib/blog/adminAuth";
import { requirePermission } from "@/server/requirePermission";
import { generateImage, ImageGenerationError } from "@/lib/ai/providers/geminiImage";
import { ensureCreditPeriod, chargeFlatCredits } from "@/lib/credits/ledger";
import { imageGenerationCredits } from "@/lib/credits/pricing";

function randomKey(): string {
  return Array.from({ length: 12 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("");
}

/**
 * The featured-image half of "AI write for me" — a deliberately simpler v1 than the text
 * generation route: always uses Plexo's own system Gemini key and always bills the
 * account's Plexo credit balance, regardless of whether that account's text AI is
 * BYOK/HOST_MANAGED/System. Building full BYOK/Host-Managed support for a brand-new image
 * capability is real extra scope this skips for now — see the "AI write for me" plan notes.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ templateId: string }> },
): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveBlogAdminSite(request, templateId);
  if ("error" in resolved) return resolved.error;

  const permissionError = await requirePermission(request.headers, resolved.context.role, { blog: ["update"] });
  if (permissionError) return permissionError;

  const body = (await request.json().catch(() => ({}))) as { prompt?: string };
  const prompt = body.prompt?.trim();
  if (!prompt) {
    return NextResponse.json({ error: "An image prompt is required." }, { status: 400 });
  }

  const apiKey = process.env.SYSTEM_AI_KEY_GOOGLE_GEMINI;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Image generation isn't configured for this deployment yet." },
      { status: 503 },
    );
  }

  const cost = imageGenerationCredits();
  const balance = await ensureCreditPeriod(resolved.context.userId);
  if (balance.total < cost) {
    return NextResponse.json(
      { error: "Insufficient credits — top up in Settings to generate a featured image." },
      { status: 402 },
    );
  }

  let image: { bytes: Buffer; mimeType: string };
  try {
    image = await generateImage({ apiKey, prompt });
  } catch (err) {
    if (err instanceof ImageGenerationError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    console.error("Unexpected image generation error:", err);
    return NextResponse.json({ error: "Image generation failed — please try again." }, { status: 502 });
  }

  const extension = image.mimeType.split("/")[1]?.replace("jpeg", "jpg") || "png";
  const localDevToken = process.env.BLOB_READ_WRITE_TOKEN;

  try {
    const blob = await put(`blog-images/${resolved.context.templateId}/${randomKey()}.${extension}`, image.bytes, {
      access: "public",
      contentType: image.mimeType,
      ...(localDevToken ? { token: localDevToken } : {}),
    });

    await chargeFlatCredits(resolved.context.userId, cost, "generate_blog_post image (google_gemini/imagen)");

    return NextResponse.json({ url: blob.url }, { status: 201 });
  } catch (err) {
    if (err instanceof BlobError) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
    throw err;
  }
}
