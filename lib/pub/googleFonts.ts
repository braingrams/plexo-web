/**
 * Curated Google Fonts catalog — copied verbatim from plexo-sdk's
 * `src/utilities/playground.constants.ts` (`GOOGLE_FONTS_LIST`) so the blog's font picker
 * matches the builder's own font list exactly. Not importable directly from the installed
 * `@charisol/plexo-sdk` package (it doesn't expose this array through any public entry
 * point), hence the copy rather than an import.
 *
 * Each entry's `value` is a ready-to-use CSS font-family string (already includes its own
 * generic fallback, e.g. "'Roboto', sans-serif") — the same shape BlogSite.fontPreset now
 * stores directly for a Google Font choice.
 */
export const GOOGLE_FONTS_LIST: Array<{ label: string; value: string; style: "sans" | "serif" | "mono" | "display" | "handwriting" }> = [
  // ── Sans-serif ──────────────────────────────────────────────────────────────
  { label: "Roboto", value: "'Roboto', sans-serif", style: "sans" },
  { label: "Open Sans", value: "'Open Sans', sans-serif", style: "sans" },
  { label: "Lato", value: "'Lato', sans-serif", style: "sans" },
  { label: "Montserrat", value: "'Montserrat', sans-serif", style: "sans" },
  { label: "Inter", value: "'Inter', sans-serif", style: "sans" },
  { label: "Poppins", value: "'Poppins', sans-serif", style: "sans" },
  { label: "Raleway", value: "'Raleway', sans-serif", style: "sans" },
  { label: "Nunito", value: "'Nunito', sans-serif", style: "sans" },
  { label: "Nunito Sans", value: "'Nunito Sans', sans-serif", style: "sans" },
  { label: "Ubuntu", value: "'Ubuntu', sans-serif", style: "sans" },
  { label: "Rubik", value: "'Rubik', sans-serif", style: "sans" },
  { label: "Plus Jakarta Sans", value: "'Plus Jakarta Sans', sans-serif", style: "sans" },
  { label: "DM Sans", value: "'DM Sans', sans-serif", style: "sans" },
  { label: "Outfit", value: "'Outfit', sans-serif", style: "sans" },
  { label: "Figtree", value: "'Figtree', sans-serif", style: "sans" },
  { label: "Karla", value: "'Karla', sans-serif", style: "sans" },
  { label: "Barlow", value: "'Barlow', sans-serif", style: "sans" },
  { label: "Work Sans", value: "'Work Sans', sans-serif", style: "sans" },
  { label: "Manrope", value: "'Manrope', sans-serif", style: "sans" },
  { label: "Jost", value: "'Jost', sans-serif", style: "sans" },
  { label: "Sora", value: "'Sora', sans-serif", style: "sans" },
  { label: "Be Vietnam Pro", value: "'Be Vietnam Pro', sans-serif", style: "sans" },
  { label: "Mulish", value: "'Mulish', sans-serif", style: "sans" },
  { label: "Noto Sans", value: "'Noto Sans', sans-serif", style: "sans" },
  { label: "Source Sans 3", value: "'Source Sans 3', sans-serif", style: "sans" },
  { label: "IBM Plex Sans", value: "'IBM Plex Sans', sans-serif", style: "sans" },
  { label: "Josefin Sans", value: "'Josefin Sans', sans-serif", style: "sans" },
  { label: "Quicksand", value: "'Quicksand', sans-serif", style: "sans" },
  { label: "Exo 2", value: "'Exo 2', sans-serif", style: "sans" },
  { label: "Titillium Web", value: "'Titillium Web', sans-serif", style: "sans" },
  // ── Serif ────────────────────────────────────────────────────────────────────
  { label: "Merriweather", value: "'Merriweather', serif", style: "serif" },
  { label: "Playfair Display", value: "'Playfair Display', serif", style: "serif" },
  { label: "Lora", value: "'Lora', serif", style: "serif" },
  { label: "PT Serif", value: "'PT Serif', serif", style: "serif" },
  { label: "Noto Serif", value: "'Noto Serif', serif", style: "serif" },
  { label: "EB Garamond", value: "'EB Garamond', serif", style: "serif" },
  { label: "Libre Baskerville", value: "'Libre Baskerville', serif", style: "serif" },
  { label: "Cormorant Garamond", value: "'Cormorant Garamond', serif", style: "serif" },
  { label: "Crimson Text", value: "'Crimson Text', serif", style: "serif" },
  { label: "DM Serif Display", value: "'DM Serif Display', serif", style: "serif" },
  { label: "Domine", value: "'Domine', serif", style: "serif" },
  { label: "Bitter", value: "'Bitter', serif", style: "serif" },
  { label: "Spectral", value: "'Spectral', serif", style: "serif" },
  { label: "Cardo", value: "'Cardo', serif", style: "serif" },
  { label: "Gilda Display", value: "'Gilda Display', serif", style: "serif" },
  // ── Monospace ────────────────────────────────────────────────────────────────
  { label: "Roboto Mono", value: "'Roboto Mono', monospace", style: "mono" },
  { label: "Source Code Pro", value: "'Source Code Pro', monospace", style: "mono" },
  { label: "Fira Code", value: "'Fira Code', monospace", style: "mono" },
  { label: "JetBrains Mono", value: "'JetBrains Mono', monospace", style: "mono" },
  { label: "IBM Plex Mono", value: "'IBM Plex Mono', monospace", style: "mono" },
  { label: "Space Mono", value: "'Space Mono', monospace", style: "mono" },
  { label: "Inconsolata", value: "'Inconsolata', monospace", style: "mono" },
  { label: "Courier Prime", value: "'Courier Prime', monospace", style: "mono" },
  // ── Display ──────────────────────────────────────────────────────────────────
  { label: "Oswald", value: "'Oswald', sans-serif", style: "display" },
  { label: "Anton", value: "'Anton', sans-serif", style: "display" },
  { label: "Bebas Neue", value: "'Bebas Neue', sans-serif", style: "display" },
  { label: "Righteous", value: "'Righteous', sans-serif", style: "display" },
  { label: "Russo One", value: "'Russo One', sans-serif", style: "display" },
  { label: "Chakra Petch", value: "'Chakra Petch', sans-serif", style: "display" },
  { label: "Orbitron", value: "'Orbitron', sans-serif", style: "display" },
  { label: "Abril Fatface", value: "'Abril Fatface', serif", style: "display" },
  { label: "Lobster", value: "'Lobster', cursive", style: "display" },
  { label: "Alfa Slab One", value: "'Alfa Slab One', serif", style: "display" },
  { label: "Archivo Black", value: "'Archivo Black', sans-serif", style: "display" },
  { label: "Bangers", value: "'Bangers', cursive", style: "display" },
  { label: "Boogaloo", value: "'Boogaloo', cursive", style: "display" },
  { label: "Fredoka One", value: "'Fredoka One', cursive", style: "display" },
  { label: "Permanent Marker", value: "'Permanent Marker', cursive", style: "display" },
  { label: "Lilita One", value: "'Lilita One', cursive", style: "display" },
  // ── Handwriting ──────────────────────────────────────────────────────────────
  { label: "Dancing Script", value: "'Dancing Script', cursive", style: "handwriting" },
  { label: "Pacifico", value: "'Pacifico', cursive", style: "handwriting" },
  { label: "Satisfy", value: "'Satisfy', cursive", style: "handwriting" },
  { label: "Caveat", value: "'Caveat', cursive", style: "handwriting" },
  { label: "Indie Flower", value: "'Indie Flower', cursive", style: "handwriting" },
  { label: "Kalam", value: "'Kalam', cursive", style: "handwriting" },
  { label: "Shadows Into Light", value: "'Shadows Into Light', cursive", style: "handwriting" },
  { label: "Amatic SC", value: "'Amatic SC', cursive", style: "handwriting" },
  { label: "Courgette", value: "'Courgette', cursive", style: "handwriting" },
  { label: "Cookie", value: "'Cookie', cursive", style: "handwriting" },
  { label: "Great Vibes", value: "'Great Vibes', cursive", style: "handwriting" },
];

const FONT_LABEL_BY_VALUE = new Map(GOOGLE_FONTS_LIST.map((f) => [f.value, f.label]));

/** Single-family equivalent of plexo-sdk's buildGoogleFontsHref (which batches every font
 * in use across a whole template) — the blog only ever has one body font at a time. Uses
 * the same legacy `css?family=` endpoint plexo-sdk uses, for the same reason: it degrades a
 * missing weight instead of 400ing. Returns null for anything not in the curated list
 * (including the 4 system stacks, which need no download). */
export function buildGoogleFontHref(fontFamilyValue: string): string | null {
  const label = FONT_LABEL_BY_VALUE.get(fontFamilyValue);
  if (!label) return null;
  const family = `${encodeURIComponent(label).replace(/%20/g, "+")}:400,700`;
  return `https://fonts.googleapis.com/css?family=${family}&display=swap`;
}
