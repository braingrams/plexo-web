import { NextRequest, NextResponse } from "next/server";

import { resolveUser } from "@/lib/auth/resolveUser";
import { generate } from "@/lib/ai/providers/bedrockClaude";
import { resolveModel } from "@/lib/ai/modelRegistry";
import { checkCommerceRateLimit } from "@/lib/commerceRateLimitDynamo";
import { listMarketplaceTemplates, type MarketplaceListItem } from "@/lib/marketplace";
import { MAX_DESCRIPTION, MIN_DESCRIPTION, buildRecommendPrompt, completePicks, parsePicks, rankByKeywords, type TemplatePick } from "@/lib/marketplace/recommend";

/**
 * POST /api/v1/marketplace/templates/recommend  { description }
 * Which free templates fit what the person says their website is for. Costs the owner nothing (one tiny platform-paid
 * model call, a few hundred tokens); falls back to a word match if the model is unavailable, so it always answers.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { description?: unknown };
  const description = typeof body.description === "string" ? body.description.trim().slice(0, MAX_DESCRIPTION) : "";
  if (description.length < MIN_DESCRIPTION) {
    return NextResponse.json({ error: "Tell us a little more about your website, for example “a bakery in Lagos that takes orders”." }, { status: 400 });
  }
  if (!(await checkCommerceRateLimit(`template-recommend:${resolved.userId}`, 20, 60 * 60 * 1000))) {
    return NextResponse.json({ error: "That's a lot of searches. Please try again in a little while." }, { status: 429 });
  }

  const items: MarketplaceListItem[] = [];
  for (let page = 1; page <= 3; page++) {
    const r = await listMarketplaceTemplates({ kind: "LANDING_PAGE", free: true, sort: "popular", page });
    items.push(...r.templates);
    if (items.length >= r.total) break;
  }
  if (items.length === 0) return NextResponse.json({ picks: [], source: "keywords" });

  let picks: TemplatePick[] = [];
  let source: "sol" | "keywords" = "keywords";
  try {
    const result = await generate({
      model: resolveModel("bedrock_claude", "BASIC"),
      apiKey: "",
      systemPrompt: "You match a person's website idea to the best starting templates. Reply with ONLY the JSON array asked for.",
      userPrompt: buildRecommendPrompt(description, items),
      maxTokens: 600,
    });
    picks = parsePicks(result.text ?? "", new Set(items.map((t) => t.id)));
    if (picks.length > 0) source = "sol";
  } catch (err) {
    console.error("template recommend: model call failed, using word match:", err);
  }
  picks = picks.length > 0 ? completePicks(picks, description, items) : rankByKeywords(description, items);
  const byId = new Map(items.map((t) => [t.id, t]));
  const withTemplates = picks.flatMap((p) => {
    const t = byId.get(p.id);
    if (!t) return [];
    const { compiledHtml: _omit, ...light } = t;
    return [{ ...p, template: light }];
  });
  return NextResponse.json({ picks: withTemplates, source });
}
