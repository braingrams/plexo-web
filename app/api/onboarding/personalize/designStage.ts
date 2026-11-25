import { NextRequest, NextResponse } from "next/server";
import type { SolBuildProfile } from "@/lib/ai/solBuildContext";
import { PlainError, gaveContactDetails, planPersonalization, writeCopy } from "@/lib/onboarding/solPersonalize";
import { cleanColors, cleanLogo, parseSolPart } from "@/lib/onboarding/designEditRequest";

type Brand = { name: string; about: string; goal: string; place?: string };
type Resolved = { userId: string; organizationId: string };

/**
 * The stages of "Personalize with SOL" for a new-editor (V2) marketplace design. SOL reads and rewrites the design's own data
 * (lib/onboarding/designSlots.ts), never a compiled page, and the preview is compiled from the edited design, so what the owner sees
 * is what the editor will hold and what publishes:
 *   "preview" → { html, designToken, warnings }                     no SOL, no charge: the design with the owner's name, description, colour and logo.
 *   "plan"    → { domain, summary, questions, slotCount, slotsKey, remove }    SOL reads the brand and the design's words (charged like before).
 *   "write"   → { replacements }                                      SOL writes copy for the numbered words (charged like before).
 *   "finish"  → { html, designToken, summary, edits, creditsRemaining } puts SOL's words into the design; no SOL, no charge.
 * Credits behave exactly as on the page-text path: an affordability check before each SOL stage, a charge after each SOL request.
 */
export async function personalizeDesign(a: {
  request: NextRequest;
  body: Record<string, unknown>;
  stage: "plan" | "write" | "finish" | "preview";
  listing: import("@/lib/onboarding/designEdit").ListingForEdit;
  resolved: Resolved;
  brand: Brand;
  brandInfo: SolBuildProfile["brand"];
  text: (v: unknown, max: number) => string | undefined;
  balanceOf: () => Promise<{ available: number }>;
}): Promise<NextResponse> {
  const { body, stage, listing, resolved, brand, brandInfo, text, balanceOf } = a;
  const { editDesign, compileEdited, designToken, slotsOfListing, slotsKeyOf } = await import("@/lib/onboarding/designEdit");
  const { slotNodes } = await import("@/lib/onboarding/designSlots");
  const design = { name: listing.name, description: listing.description ?? undefined };
  const { slots, removable } = slotsOfListing(listing);

  const answers = Array.isArray(body.answers)
    ? (body.answers as Array<{ question?: unknown; answer?: unknown }>).map((x) => ({ question: text(x?.question, 200) ?? "", answer: text(x?.answer, 300) ?? "" })).slice(0, 6)
    : [];

  /** The design as the owner will see it, built from the listing and the recipe. */
  const build = async (sol: ReturnType<typeof parseSolPart>) => {
    const edits = {
      name: text(brandInfo?.name, 120) ?? "",
      about: brand.about || undefined,
      designName: listing.name,
      designDescription: listing.description ?? undefined,
      colors: cleanColors(brandInfo?.colors),
      logoUrl: cleanLogo(brandInfo?.logoUrl),
      ...sol,
    };
    const edited = await editDesign(listing.designJson, edits, { look: true });
    let html: string;
    try {
      html = await compileEdited(listing, edited.design);
    } catch (err) {
      console.warn("[onboarding/personalize] compiling the edited design failed", err);
      throw new PlainError("We couldn't show this design just now. Please try again: nothing was changed.");
    }
    return { html, designToken: designToken(listing.id, edits), warnings: edited.warnings, edited, edits };
  };

  try {
    if (stage === "preview") {
      const built = await build(parseSolPart(body.edits));
      return NextResponse.json({ html: built.html, designToken: built.designToken, warnings: built.warnings });
    }

    if (stage === "finish") {
      const sol = parseSolPart({ ...(body.edits && typeof body.edits === "object" ? body.edits : {}), copy: body.replacements, remove: body.remove, domain: body.domain, slotsKey: body.slotsKey, contact: gaveContactDetails(answers) });
      const built = await build(sol);
      const updated = await balanceOf();
      return NextResponse.json({
        html: built.html,
        designToken: built.designToken,
        summary: `SOL wrote your headlines, cards and buttons for "${brand.name}".`,
        warnings: built.warnings,
        edits: sol,
        creditsRemaining: updated.available,
      });
    }

    const { solRouteForUser, tierFor, checkCanAfford } = await import("@/lib/ai/solEngine");
    const solRoute = await solRouteForUser(resolved.userId);
    if ("error" in solRoute) return NextResponse.json({ error: solRoute.error }, { status: solRoute.status });
    const tier = tierFor(solRoute.route, solRoute.plan, "MEDIUM");
    const nodes = slotNodes(slots);
    if (nodes.length === 0) return NextResponse.json({ error: "This design has no words SOL can change. Pick another one." }, { status: 400 });
    const approxChars = nodes.reduce((n, x) => n + x.text.length, 0) + 3000;
    const cannotAfford = await checkCanAfford(resolved.userId, solRoute.route, tier, "edit_raw_html", approxChars);
    if (cannotAfford) {
      const balance = await balanceOf();
      return NextResponse.json({ error: "SOL needs more credits to do this. Add some and carry on, or create your website now and make it yours later.", outOfCredits: true, availableCredits: balance.available }, { status: 402 });
    }
    const ctx = { route: solRoute.route, tier, userId: resolved.userId };

    if (stage === "plan") {
      const briefs = removable.map((s, i) => ({ n: i + 1, kind: s.kind, preview: s.preview }));
      const plan = await planPersonalization(ctx, brand, design, nodes, briefs);
      const remove = (plan.remove ?? []).map((n) => removable[n - 1]?.id).filter((id): id is string => !!id);
      return NextResponse.json({ domain: plan.domain, summary: plan.summary, questions: plan.questions, slotCount: nodes.length, slotsKey: slotsKeyOf(slots), remove });
    }

    const wanted = Array.isArray(body.ids) ? new Set((body.ids as unknown[]).filter((i): i is number => typeof i === "number")) : null;
    const toWrite = wanted ? nodes.filter((n) => wanted.has(n.id)) : nodes;
    if (toWrite.length === 0) return NextResponse.json({ replacements: {} });
    const replacements = await writeCopy(ctx, brand, design, toWrite, answers.filter((x) => x.question && x.answer));
    return NextResponse.json({ replacements });
  } catch (err) {
    if (err instanceof PlainError) return NextResponse.json({ error: err.message }, { status: 502 });
    throw err;
  }
}
