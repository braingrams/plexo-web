import { NextRequest, NextResponse } from "next/server";

import { resolveUser } from "@/lib/auth/resolveUser";
import { resolveModel } from "@/lib/ai/modelRegistry";
import { callProvider, MAX_TOKENS } from "@/lib/ai/generate";
import { chargeFor, checkCanAfford, solRouteForUser, tierFor } from "@/lib/ai/solEngine";

// The SDK file editor opens a picture (or a scanned PDF page) and asks SOL to describe its parts — text, boxes, photos, each with a
// position — so the editor can rebuild it as real, editable elements. The reply is a JSON "spec" the SDK validates and builds from
// (plexo-sdk: src/v2/files/aiPicture.ts, which keeps an identical copy of this prompt). SOL's rules apply (lib/ai/solEngine.ts): the
// account's own key or Plexo's AI, affordable up front, and what was actually used charged afterwards.
export const maxDuration = 120;

const PROMPT = `You turn a picture of a design (a poster, flyer, web page, social post, slide, screenshot, document page) into a description of its parts, so each part can be rebuilt as an editable element. You are shown ONE picture of exactly {width}x{height} pixels. Measure everything in those pixels, origin at the top-left.

Reply with ONLY one JSON object, no markdown, no commentary:
{"width":{width},"height":{height},"background":"#rrggbb","elements":[ ... ]}

Elements, listed from the back to the front (things drawn underneath come first):
- {"type":"shape","x":0,"y":0,"w":0,"h":0,"fill":"#rrggbb","radius":0,"borderWidth":0,"borderColor":"#rrggbb","shadow":false,"opacity":1}  for every plain coloured area: cards, buttons, bars, banners, dividers, circles (radius = half the size), panels. Leave fill out for outline-only boxes.
- {"type":"text","text":"exact words","x":0,"y":0,"w":0,"fontSize":0,"color":"#rrggbb","bold":false,"italic":false,"align":"left","uppercase":false,"lineHeight":1.25,"letterSpacing":0}  for every piece of writing. x,y is the top-left of the text block, w its width, fontSize the height of a capital letter times 1.4 (in pixels). Keep a paragraph as ONE element with its own line breaks removed; give a separate element to each heading, label and button caption. Copy the words exactly as written; do not translate or fix them.
- {"type":"picture","x":0,"y":0,"w":0,"h":0,"radius":0,"label":"what it shows"}  for every photo or illustration or logo, anything that is an image rather than flat colour or writing. It will be cut out of the original, so only give its box.

Rules: be exact about positions and sizes; use the real colours you see; do not invent anything that is not in the picture; do not describe text that is inside a "picture" box separately; at most 250 elements (group tiny repeated details into one picture); the numbers are plain numbers, never strings.`;

const MAX_IMAGE_CHARS = 5_500_000; // base64 text; the editor sends at most 1600px as JPEG, far below this

function cleanJson(raw: string): string {
  let t = raw.trim();
  if (t.startsWith("```")) {
    const lines = t.split("\n");
    if (lines[0].startsWith("```")) lines.shift();
    if (lines[lines.length - 1]?.startsWith("```")) lines.pop();
    t = lines.join("\n").trim();
  }
  return t;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) return NextResponse.json({ error: "You're signed out. Sign in again, then try once more." }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { image?: unknown; width?: unknown; height?: unknown };
  const image = typeof body.image === "string" ? body.image : "";
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(image);
  const width = Number(body.width);
  const height = Number(body.height);
  if (!match || !Number.isFinite(width) || !Number.isFinite(height) || width < 16 || height < 16 || width > 4000 || height > 4000) {
    return NextResponse.json({ error: "That picture couldn't be read. Try a PNG or JPG." }, { status: 400 });
  }
  if (image.length > MAX_IMAGE_CHARS) {
    return NextResponse.json({ error: "That picture is too large to read. Try a smaller one." }, { status: 413 });
  }

  const userId = resolved.userId;
  const solRoute = await solRouteForUser(userId);
  if ("error" in solRoute) return NextResponse.json({ error: solRoute.error }, { status: solRoute.status });
  const { route } = solRoute;
  if (route.provider === "openai") {
    return NextResponse.json({ error: "Rebuilding a picture needs an AI that can see images. Switch to Plexo's AI or a Claude or Gemini key in Settings." }, { status: 400 });
  }
  const tier = tierFor(route, solRoute.plan, "MEDIUM");
  // A picture costs roughly one token per 750 pixels; hold generously for it.
  const approxChars = Math.max(9000, Math.round(((Math.round(width) * Math.round(height)) / 750) * 3)) + PROMPT.length;
  const cannotAfford = await checkCanAfford(userId, route, tier, "image_to_design", approxChars);
  if (cannotAfford) return NextResponse.json({ error: cannotAfford.error }, { status: cannotAfford.status });

  const w = Math.round(width);
  const h = Math.round(height);
  let usage: { inputTokens?: number; outputTokens?: number } | undefined;
  try {
    const result = await callProvider(
      route.provider,
      resolveModel(route.provider, tier),
      route.apiKey,
      PROMPT.replaceAll("{width}", String(w)).replaceAll("{height}", String(h)),
      "Describe this picture as the JSON object.",
      MAX_TOKENS.image_to_design,
      undefined,
      [{ mediaType: match[1], data: match[2], name: "picture" }],
    );
    usage = result.usage;
    if (result.truncated) {
      return NextResponse.json({ error: "This picture has too much in it for the AI to describe in one go. Try a simpler or smaller picture." }, { status: 422 });
    }
    let spec: unknown;
    try {
      spec = JSON.parse(cleanJson(result.text));
    } catch {
      return NextResponse.json({ error: "The AI's answer couldn't be read. Try again in a moment." }, { status: 502 });
    }
    return NextResponse.json({ spec });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error && err.message ? "The AI couldn't read this picture. Try again in a moment." : "The AI couldn't read this picture." }, { status: 502 });
  } finally {
    // What was used is charged even when the answer couldn't be used (Plexo's AI only; see chargeFor).
    await chargeFor(userId, route, tier, "image_to_design", usage).catch(() => undefined);
  }
}
