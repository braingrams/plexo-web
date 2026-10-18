import { convertV1Design, type ConvertV1Fidelity } from "@charisol/plexo-sdk/v2/compile";

import { parseV2Design, type V2Design, type V2Meta } from "@/lib/v2/design";

// Moving a classic (V1) page to the new editor. The SDK's convertV1Design does the design; this
// adds what the SDK leaves to the host (the page's tab title / search details that V1 kept in
// body.style, and the owner's own script) and validates the result like any other V2 save.
// Pure and React-free: the dashboard dialog runs it for the preview, and the convert route runs
// the very same function on the stored design (it never trusts a design sent from the browser).

export type ConversionResult =
  | { ok: true; design: V2Design; fidelity: ConvertV1Fidelity; warnings: string[] }
  | { ok: false; error: string };

const META_KEYS = ["htmlTitle", "favicon", "metaDescription", "ogImageUrl"] as const;

function metaFromV1(v1: unknown): V2Meta | undefined {
  const style = (v1 as { body?: { style?: Record<string, unknown> } } | null)?.body?.style;
  if (!style || typeof style !== "object") return undefined;
  const meta: Record<string, string> = {};
  for (const key of META_KEYS) {
    const v = style[key];
    if (typeof v === "string" && v.trim()) meta[key] = v;
  }
  return Object.keys(meta).length ? (meta as V2Meta) : undefined;
}

export function convertV1ToV2(v1Design: unknown, page: { id: string; name: string; slug?: string | null; isHome: boolean }): ConversionResult {
  let result;
  try {
    result = convertV1Design(v1Design, { id: page.id, name: page.name, slug: page.slug ?? undefined, isHome: page.isHome });
  } catch {
    return { ok: false, error: "This page's design couldn't be read, so it can't move to the new editor." };
  }
  const meta = metaFromV1(v1Design);
  const parsed = parseV2Design({
    format: "plexo-v2@1",
    pages: [result.page],
    ...(result.extras.customJs ? { customJs: result.extras.customJs } : {}),
    ...(meta ? { meta } : {}),
  });
  if (!parsed.ok) return { ok: false, error: parsed.error };
  return { ok: true, design: parsed.design, fidelity: result.fidelity, warnings: result.warnings };
}

export type ConversionNotes = {
  /** One calm sentence for the top of the checklist. */
  headline: string;
  /** Still there, but looks or behaves slightly differently. */
  differs: string[];
  /** Left out: the owner has to add these again. */
  missing: string[];
};

const MISSING = /left out|can.t be carried over|isn.t supported|not supported|dropped/i;

/** The SDK's plain-language warnings, sorted into the two things an owner wants to know. */
export function describeConversion(fidelity: ConvertV1Fidelity, warnings: string[]): ConversionNotes {
  const unique = [...new Set(warnings)];
  const missing = unique.filter((w) => MISSING.test(w));
  const differs = unique.filter((w) => !MISSING.test(w));
  const headline =
    fidelity === "exact"
      ? "Everything on this page moves over as it is."
      : fidelity === "approximate"
        ? "Everything moves over, and a few things will look slightly different."
        : "Most of this page moves over, but some blocks can't come along yet.";
  return { headline, differs, missing };
}

/** Which classic pages can move to the new editor: ordinary landing pages, not emails, uploaded HTML, apps or shared layouts. */
export function canMoveToV2(row: {
  kind?: string | null;
  sourceType?: string | null;
  designFormat?: string | null;
  isBlogLayout?: boolean | null;
  isSiteLayoutFragment?: boolean | null;
  isCommerceLayout?: boolean | null;
  isLmsPageDesign?: boolean | null;
}): boolean {
  return (
    row.kind === "LANDING_PAGE" &&
    (row.sourceType ?? "BUILDER") === "BUILDER" &&
    row.designFormat !== "v2" &&
    !row.isBlogLayout &&
    !row.isSiteLayoutFragment &&
    !row.isCommerceLayout &&
    !row.isLmsPageDesign
  );
}
