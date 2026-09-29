export type CommerceButtonRadius = "sharp" | "rounded" | "pill";

export type CommerceTheme = {
  accentColor: string;
  buttonRadius: CommerceButtonRadius;
};

/**
 * Auto-derives the commerce widget's accent color and button shape from a site's OWN real
 * content, so "Add to Cart"/cart/checkout UI matches a merchant's brand out of the box with
 * zero setup — instead of every Plexo commerce site sharing one hardcoded look (see
 * public/commerce.js's own comment on where these values ultimately get consumed). Scans
 * every filled button (a real color choice the site owner or their page-builder AI already
 * made) rather than guessing from arbitrary section backgrounds. Returns null when there's no
 * signal (a brand-new/blank site) — callers must fall back to today's hardcoded default in
 * that case, so a site with nothing to detect renders byte-identical to before this existed.
 */
export function deriveCommerceTheme(designJson: unknown): CommerceTheme | null {
  const colorCounts = new Map<string, number>();
  const radiusCounts = new Map<string, number>();

  function isFilled(bg: unknown): bg is string {
    return typeof bg === "string" && bg.trim() !== "" && bg.trim().toLowerCase() !== "transparent";
  }

  function bump(map: Map<string, number>, key: string) {
    map.set(key, (map.get(key) ?? 0) + 1);
  }

  function walkElements(elements: unknown) {
    if (!Array.isArray(elements)) return;
    for (const el of elements) {
      if (!el || typeof el !== "object") continue;
      const e = el as { type?: unknown; style?: { backgroundColor?: unknown; borderRadius?: unknown } };
      if (e.type === "button" && isFilled(e.style?.backgroundColor)) {
        bump(colorCounts, (e.style!.backgroundColor as string).trim());
        const radius = e.style?.borderRadius;
        if (typeof radius === "string" && radius.trim() !== "") bump(radiusCounts, radius.trim());
      }
    }
  }

  function walkColumns(columns: unknown) {
    if (!Array.isArray(columns)) return;
    for (const col of columns) {
      if (!col || typeof col !== "object") continue;
      const c = col as { elements?: unknown; nestedRows?: unknown };
      walkElements(c.elements);
      walkRows(c.nestedRows);
    }
  }

  function walkRows(rows: unknown) {
    if (!Array.isArray(rows)) return;
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      walkColumns((row as { columns?: unknown }).columns);
    }
  }

  const rows = (designJson as { body?: { rows?: unknown } } | null)?.body?.rows;
  walkRows(rows);

  const accentColor = mostFrequent(colorCounts);
  if (!accentColor) return null;

  const rawRadius = mostFrequent(radiusCounts);
  return { accentColor, buttonRadius: bucketRadius(rawRadius) };
}

function mostFrequent(counts: Map<string, number>): string | null {
  let best: string | null = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/** px thresholds picked to match the "sharp editorial / rounded / full pill" vocabulary
 * already used across builder-authored sites — e.g. "2px" reads as sharp, "50px"/"100px"/
 * "50%" as a pill, anything in between as a generic rounded corner. */
function bucketRadius(raw: string | null): CommerceButtonRadius {
  if (!raw) return "sharp";
  const value = raw.trim().toLowerCase();
  if (value === "50%" || value === "9999px") return "pill";
  const px = parseFloat(value);
  if (Number.isNaN(px)) return "sharp";
  if (px >= 24) return "pill";
  if (px >= 4) return "rounded";
  return "sharp";
}
