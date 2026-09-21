import { GOOGLE_FONTS_LIST } from "./googleFonts";

// Split out of lib/pub/blogTheme.tsx so FONT_PRESET_OPTIONS (and resolveFontStack, which
// BlogStyles below still needs) have NO `next/link` import anywhere in their own module —
// blogTheme.tsx itself imports `Link` from "next/link" for its JSX components (BlogStyles,
// SiteHeader, PostCard, etc., all real presentational components rendered inside actual
// Next.js pages), and esbuild bundles a whole module's imports regardless of which export
// within it is actually used. lib/mcp/blogTools.ts (reachable from lambda/sol-chat/index.ts's
// standalone Lambda bundle via lib/ai/solAgent.ts -> lib/mcp/dispatchMcpTool.ts) needs
// FONT_PRESET_OPTIONS but must never pull in next/link, which (unlike next/server/next/
// headers) doesn't itself require "@opentelemetry/api" but is still real Next.js client
// runtime code with no place in a bare Lambda bundle. blogTheme.tsx re-exports
// FONT_PRESET_OPTIONS from here so every existing call site that already imports it from
// that file keeps working unchanged.

// The 4 original no-download system stacks, kept as-is for anyone who picked them before
// the full Google Fonts catalog was added below.
const SYSTEM_FONT_STACKS: Record<string, string> = {
  sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  serif: 'Georgia, "Times New Roman", Times, serif',
  modern: '"Helvetica Neue", Helvetica, Arial, sans-serif',
  elegant: '"Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif',
};

const SYSTEM_FONT_OPTIONS = [
  { value: "sans", label: "Sans-serif (default)" },
  { value: "serif", label: "Serif (classic editorial)" },
  { value: "modern", label: "Modern sans" },
  { value: "elegant", label: "Elegant serif" },
];

// Every selectable value in the Font dropdown — the 4 system stacks plus the full curated
// Google Fonts catalog (see googleFonts.ts). Still a closed, code-controlled set (never a
// raw user-supplied font-family string) even though it's now ~85 entries instead of 4 —
// see BlogSite.fontPreset's schema comment for why that invariant matters. A Google Font's
// `value` doubles as its own CSS font stack (it already includes a generic fallback, e.g.
// "'Roboto', sans-serif"), so no separate stacks table is needed for those.
export const FONT_PRESET_OPTIONS = [
  ...SYSTEM_FONT_OPTIONS,
  ...GOOGLE_FONTS_LIST.map((f) => ({ value: f.value, label: f.label })),
];

const VALID_FONT_PRESET_VALUES = new Set(FONT_PRESET_OPTIONS.map((o) => o.value));

export function resolveFontStack(preset?: string | null): string {
  if (preset && SYSTEM_FONT_STACKS[preset]) return SYSTEM_FONT_STACKS[preset];
  if (preset && VALID_FONT_PRESET_VALUES.has(preset)) return preset;
  return SYSTEM_FONT_STACKS.sans;
}
