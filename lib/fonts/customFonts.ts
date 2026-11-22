/**
 * Fonts an owner uploaded for their brand ("Upload my own font"). The file itself is stored by /api/v1/media/font (the same upload the
 * visual editor's "Add a font" uses); this is the list of them kept on the site's brand record, with the same shape as the
 * visual editor's custom fonts (plexo-sdk v2/design/customFonts.ts) so one list can feed both. Pure.
 */
export type CustomFontFormat = "woff2" | "woff" | "truetype" | "opentype";
export type CustomFontVariant = { weight: number; style: "normal" | "italic"; url: string; format: CustomFontFormat };
export type CustomFont = { family: string; variants: CustomFontVariant[] };

export const MAX_CUSTOM_FONTS = 12;
export const MAX_FONT_VARIANTS = 12;
export const FONT_FILE_ACCEPT = ".woff2,.woff,.ttf,.otf";
export const MAX_FONT_FILE_BYTES = 3 * 1024 * 1024;

const FAMILY = /^[A-Za-z0-9][A-Za-z0-9 ]{0,47}$/;
const FORMATS: readonly CustomFontFormat[] = ["woff2", "woff", "truetype", "opentype"];
/** Fonts every browser has: an uploaded font may not borrow one of these names. */
const SYSTEM = new Set(["serif", "sans-serif", "monospace", "cursive", "arial", "helvetica", "georgia", "times new roman", "courier new", "verdana", "tahoma", "trebuchet ms", "system-ui"]);

/** An address a font may load from: https, or a path on the site. No quotes, brackets or spaces. */
export const isFontUrl = (url: unknown): url is string => typeof url === "string" && url.length <= 2000 && !/[\s"'\\()<>]/.test(url) && (/^https:\/\/[^/?#]+/i.test(url) || /^\/(?!\/)/.test(url));

/** Cleans untrusted custom-font data. Bad entries are dropped, duplicates merged, extras cut. Always returns a safe list. */
export function sanitizeCustomFonts(input: unknown): CustomFont[] {
  if (!Array.isArray(input)) return [];
  const out: CustomFont[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const family = typeof (raw as CustomFont).family === "string" ? (raw as CustomFont).family.trim().replace(/\s+/g, " ") : "";
    if (!FAMILY.test(family) || SYSTEM.has(family.toLowerCase())) continue;
    const variants: CustomFontVariant[] = [];
    for (const v of Array.isArray((raw as CustomFont).variants) ? (raw as CustomFont).variants : []) {
      const weight = Number(v?.weight);
      if (variants.length >= MAX_FONT_VARIANTS || !Number.isInteger(weight) || weight < 100 || weight > 900 || weight % 100 !== 0 || !isFontUrl(v?.url) || !FORMATS.includes(v?.format)) continue;
      const style = v.style === "italic" ? "italic" : "normal";
      const next: CustomFontVariant = { weight, style, url: v.url, format: v.format };
      const i = variants.findIndex((x) => x.weight === weight && x.style === style);
      if (i >= 0) variants[i] = next;
      else variants.push(next);
    }
    if (!variants.length) continue;
    const at = out.findIndex((f) => f.family.toLowerCase() === family.toLowerCase());
    if (at >= 0) {
      const merged = [...out[at].variants.filter((a) => !variants.some((b) => b.weight === a.weight && b.style === a.style)), ...variants];
      out[at] = { family: out[at].family, variants: merged.slice(0, MAX_FONT_VARIANTS) };
    } else if (out.length < MAX_CUSTOM_FONTS) out.push({ family, variants: variants.sort((a, b) => a.weight - b.weight) });
  }
  return out;
}

export const addCustomFontVariant = (list: CustomFont[] | undefined, family: string, variant: CustomFontVariant): CustomFont[] => sanitizeCustomFonts([...(list ?? []), { family, variants: [variant] }]);
export const removeCustomFontFamily = (list: CustomFont[] | undefined, family: string): CustomFont[] => (list ?? []).filter((f) => f.family.toLowerCase() !== family.trim().toLowerCase());

/** @font-face rules with font-display: swap, so text shows at once and swaps when the file arrives. */
export function customFontFaceCss(fonts: CustomFont[] | undefined): string {
  return sanitizeCustomFonts(fonts)
    .flatMap((f) => f.variants.map((v) => `@font-face{font-family:"${f.family}";font-style:${v.style};font-weight:${v.weight};font-display:swap;src:url("${v.url}") format("${v.format}")}`))
    .join("\n");
}

const EXT: Record<string, CustomFontFormat> = { woff2: "woff2", woff: "woff", ttf: "truetype", otf: "opentype" };
const WORDS: Array<[RegExp, number]> = [[/\bthin\b|hairline/i, 100], [/extra ?light|ultra ?light/i, 200], [/\blight\b/i, 300], [/\bmedium\b/i, 500], [/semi ?bold|demi ?bold/i, 600], [/extra ?bold|ultra ?bold|heavy/i, 800], [/\bblack\b/i, 900], [/\bbold\b/i, 700]];

/** A family name, weight, style and format guessed from a file's name ("Brandon-Bold.woff2" -> Brandon, 700). The owner can fix it. */
export function guessFontFromFile(fileName: string): { family: string; weight: number; style: "normal" | "italic"; format: CustomFontFormat | null } {
  const ext = /\.([A-Za-z0-9]+)$/.exec(fileName)?.[1]?.toLowerCase() ?? "";
  const base = fileName.replace(/\.[A-Za-z0-9]+$/, "").replace(/_+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/-/g, " ");
  const style = /italic|oblique/i.test(base) ? "italic" : "normal";
  let weight = 400;
  for (const [re, w] of WORDS) if (re.test(base)) { weight = w; break; }
  let family = base.replace(/italic|oblique/gi, " ");
  for (const [re] of WORDS) family = family.replace(new RegExp(re.source, "gi"), " ");
  family = family.replace(/\bregular\b/gi, " ").replace(/[^A-Za-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 48);
  return { family, weight, style, format: EXT[ext] ?? null };
}
