/** Reads the colours and fonts out of a site's hosted brand sheet so the hub can show them (lib/brand/siteBrand.ts writes the sheet). */

const COLOR_TOKENS: { token: string; label: string }[] = [
  { token: "--color-action-primary-bg", label: "Buttons" },
  { token: "--color-brand-primary-500", label: "Main colour" },
  { token: "--color-brand-secondary-500", label: "Second colour" },
  { token: "--color-bg-canvas", label: "Background" },
  { token: "--color-text-primary", label: "Text" },
];
const FONT_TOKENS: { token: string; label: string }[] = [
  { token: "--font-family-heading", label: "Headings" },
  { token: "--font-family-body", label: "Text" },
];

export type BrandLook = { colors: { label: string; value: string }[]; fonts: { label: string; family: string }[] };

function declaration(css: string, token: string): string | null {
  const m = new RegExp(`(?:^|[{;\\s])${token.replace(/[-]/g, "\\-")}\\s*:\\s*([^;}]+)`).exec(css);
  return m ? m[1].trim() : null;
}

export function brandLook(css: string): BrandLook {
  const colors: BrandLook["colors"] = [];
  for (const { token, label } of COLOR_TOKENS) {
    const v = declaration(css, token);
    if (v && /^(#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\))$/i.test(v) && !colors.some((c) => c.value.toLowerCase() === v.toLowerCase())) colors.push({ label, value: v });
  }
  const fonts: BrandLook["fonts"] = [];
  for (const { token, label } of FONT_TOKENS) {
    const v = declaration(css, token);
    const family = v?.split(",")[0]?.replace(/["']/g, "").trim();
    if (family && !fonts.some((f) => f.family === family)) fonts.push({ label, family });
  }
  return { colors, fonts };
}
