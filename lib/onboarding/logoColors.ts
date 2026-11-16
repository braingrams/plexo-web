/**
 * Picks the brand colours out of a logo's pixels (RGBA bytes). Pure: the wizard draws the logo
 * small on a canvas and passes the bytes. Ignores transparent, near-white and near-grey pixels
 * (backgrounds, outlines) and groups similar colours, most common first.
 */
const hex2 = (n: number) => n.toString(16).padStart(2, "0");

export function dominantColors(rgba: ArrayLike<number>, max = 4): string[] {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const [r, g, b, a] = [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]];
    if (a < 200) continue;
    const hi = Math.max(r, g, b);
    const lo = Math.min(r, g, b);
    if (hi - lo < 24) continue; // grey, white or black: not a brand colour
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const cur = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    cur.n++; cur.r += r; cur.g += g; cur.b += b;
    buckets.set(key, cur);
  }
  const ranked = [...buckets.values()].sort((x, y) => y.n - x.n).map((c) => [Math.round(c.r / c.n), Math.round(c.g / c.n), Math.round(c.b / c.n)] as const);
  const out: (readonly [number, number, number])[] = [];
  for (const c of ranked) {
    if (out.every((o) => Math.abs(o[0] - c[0]) + Math.abs(o[1] - c[1]) + Math.abs(o[2] - c[2]) > 90)) out.push(c);
    if (out.length >= max) break;
  }
  return out.map(([r, g, b]) => `#${hex2(r)}${hex2(g)}${hex2(b)}`.toUpperCase());
}
