import { customFontFaceCss, type CustomFont } from "./customFonts";
import { findFont, fontsImportHrefs } from "./catalogue";

/**
 * The font part of a site's hosted brand sheet: the @import lines that load the brand's Google fonts (only the weights they are used at,
 * and only weights the family really has, with display=swap so text shows at once) and @font-face rules for fonts the owner uploaded.
 * It replaces the plexo-sdk's own font lines, which only know a few hundred families. Pure.
 */
type Token = { key: string; value: string; type?: string; unit?: string | null };

const firstFamily = (stack: string): string | null => {
  const f = stack.split(",")[0]?.trim().replace(/^["']|["']$/g, "").trim();
  return f && /^[A-Za-z0-9][A-Za-z0-9 ]{0,63}$/.test(f) ? f : null;
};

export function brandFontCss(tokens: Token[], custom: CustomFont[] | undefined): string {
  const byKey = new Map(tokens.map((t) => [t.key, t.value]));
  const weightOf = (key: string, fallback: number) => {
    const n = Number(String(byKey.get(key) ?? "").trim());
    return Number.isInteger(n) && n >= 100 && n <= 900 ? n : fallback;
  };
  const resolve = (v: string | undefined, depth = 0): string | undefined => {
    const m = v && /^var\(\s*(--[\w-]+)/.exec(v.trim());
    return m && depth < 6 ? resolve(byKey.get(m[1]), depth + 1) : v;
  };
  const uploaded = new Set((custom ?? []).map((f) => f.family.toLowerCase()));
  const want = new Map<string, Set<number>>();
  for (const t of tokens) {
    if (t.type !== "font family") continue;
    const family = firstFamily(resolve(t.value) ?? "");
    if (!family || uploaded.has(family.toLowerCase()) || !findFont(family)) continue;
    const role = /heading|display|title/.test(t.key) ? weightOf("--font-weight-heading", 700) : weightOf("--font-weight-body", 400);
    const set = want.get(family) ?? new Set<number>([400, 700]);
    set.add(role);
    want.set(family, set);
  }
  const imports = fontsImportHrefs([...want].map(([family, w]) => ({ family, weights: [...w] }))).map((href) => `@import url("${href}");`);
  const faces = customFontFaceCss(custom);
  return [...imports, faces].filter(Boolean).join("\n");
}
