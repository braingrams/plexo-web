"use client";

// Options & variants for one product ("Size: S, M, L" × "Colour: Red, Blue"). The owner
// types each option and its values; one row per combination appears automatically for its
// price, sale "was" price, stock and SKU. Rows are matched by their option values, so
// editing the options keeps everything already typed for combinations that still exist —
// and each variant keeps its id, so carts and past orders pointing at it stay correct.
// Validated again server-side (lib/commerce/variants.ts).

export interface OptionDraft {
  name: string;
  /** Comma-separated, as typed. */
  values: string;
}

export interface VariantDraft {
  id?: string;
  options: Record<string, string>;
  price: string;
  compareAt: string;
  stock: string;
  sku: string;
  active: boolean;
  imageUrl?: string | null;
}

export const MAX_OPTIONS = 3;

export function splitValues(values: string): string[] {
  const seen = new Set<string>();
  return values
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v && !seen.has(v.toLowerCase()) && seen.add(v.toLowerCase()));
}

/** Rows match combinations by their values in option order — so renaming an option ("Size" → "Sizes") keeps every price already typed. */
function valuesKey(values: string[]): string {
  return values.map((v) => v.toLowerCase()).join("\u0000");
}

/** Every combination of the options' values, reusing an existing row's data where the combination already existed. */
export function syncVariantRows(options: OptionDraft[], rows: VariantDraft[], defaults: { price: string }): VariantDraft[] {
  const usable = options.map((o) => ({ name: o.name.trim(), values: splitValues(o.values) })).filter((o) => o.name && o.values.length > 0);
  if (usable.length === 0) return [];
  let combos: string[][] = [[]];
  for (const o of usable) combos = combos.flatMap((c) => o.values.map((v) => [...c, v]));
  const byKey = new Map(rows.map((r) => [valuesKey(Object.values(r.options)), r]));
  return combos.slice(0, 100).map((values) => {
    const options = Object.fromEntries(usable.map((o, i) => [o.name, values[i]]));
    const existing = byKey.get(valuesKey(values));
    return existing ? { ...existing, options } : { options, price: defaults.price, compareAt: "", stock: "", sku: "", active: true };
  });
}

const cell: React.CSSProperties = {
  width: "100%",
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 7,
  color: "#f0f2ff",
  padding: "0.4rem 0.5rem",
  fontSize: "0.8rem",
  outline: "none",
  fontFamily: "inherit",
};
const muted: React.CSSProperties = { fontSize: "0.74rem", color: "#8a92b6", lineHeight: 1.5 };

export function VariantsEditor({
  enabled,
  onToggle,
  options,
  rows,
  currencySymbol,
  defaultPrice,
  onChange,
}: {
  enabled: boolean;
  onToggle: (on: boolean) => void;
  options: OptionDraft[];
  rows: VariantDraft[];
  currencySymbol: string;
  defaultPrice: string;
  onChange: (options: OptionDraft[], rows: VariantDraft[]) => void;
}) {
  const setOptions = (next: OptionDraft[]) => onChange(next, syncVariantRows(next, rows, { price: defaultPrice }));
  const setRow = (i: number, patch: Partial<VariantDraft>) => onChange(options, rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "0.8rem 0.9rem", display: "flex", flexDirection: "column", gap: "0.7rem" }}>
      <label style={{ display: "flex", alignItems: "center", gap: "0.55rem", cursor: "pointer" }}>
        <input type="checkbox" checked={enabled} onChange={(e) => onToggle(e.target.checked)} />
        <span style={{ fontSize: "0.84rem", fontWeight: 600, color: "#f0f2ff" }}>This product comes in options (size, colour…)</span>
      </label>
      {!enabled ? (
        <span style={muted}>Turn on to sell e.g. a T-shirt in several sizes and colours, each with its own price, stock and SKU.</span>
      ) : (
        <>
          {options.map((o, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "minmax(0, 0.8fr) minmax(0, 2fr) auto", gap: "0.5rem", alignItems: "center" }}>
              <input style={cell} value={o.name} placeholder={i === 0 ? "Size" : i === 1 ? "Colour" : "Material"} onChange={(e) => setOptions(options.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <input style={cell} value={o.values} placeholder={i === 0 ? "S, M, L, XL" : i === 1 ? "Red, Blue, Black" : "Cotton, Linen"} onChange={(e) => setOptions(options.map((x, j) => (j === i ? { ...x, values: e.target.value } : x)))} />
              <button type="button" onClick={() => setOptions(options.filter((_, j) => j !== i))} style={{ ...cell, width: "auto", cursor: "pointer" }} aria-label={`Remove option ${o.name || i + 1}`}>
                ✕
              </button>
            </div>
          ))}
          {options.length < MAX_OPTIONS && (
            <button type="button" onClick={() => setOptions([...options, { name: "", values: "" }])} style={{ ...cell, width: "fit-content", cursor: "pointer", color: "#a5b4fc" }}>
              + Add option
            </button>
          )}
          <span style={muted}>Separate values with commas. A row appears below for every combination.</span>

          {rows.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: "0 6px", fontSize: "0.78rem" }}>
                <thead>
                  <tr style={{ color: "#8a92b6", textAlign: "left" }}>
                    <th style={{ fontWeight: 600 }}>Variant</th>
                    <th style={{ fontWeight: 600 }}>Price ({currencySymbol})</th>
                    <th style={{ fontWeight: 600 }}>Was ({currencySymbol})</th>
                    <th style={{ fontWeight: 600 }}>Stock</th>
                    <th style={{ fontWeight: 600 }}>SKU</th>
                    <th style={{ fontWeight: 600 }}>On sale</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={Object.values(r.options).join("/")} style={{ opacity: r.active ? 1 : 0.5 }}>
                      <td style={{ color: "#f0f2ff", paddingRight: 8, whiteSpace: "nowrap" }}>{Object.values(r.options).join(" / ")}</td>
                      <td style={{ paddingRight: 6 }}><input style={cell} type="number" min="0" value={r.price} onChange={(e) => setRow(i, { price: e.target.value })} /></td>
                      <td style={{ paddingRight: 6 }}><input style={cell} type="number" min="0" value={r.compareAt} placeholder="—" onChange={(e) => setRow(i, { compareAt: e.target.value })} /></td>
                      <td style={{ paddingRight: 6 }}><input style={cell} type="number" min="0" value={r.stock} placeholder="∞" onChange={(e) => setRow(i, { stock: e.target.value })} /></td>
                      <td style={{ paddingRight: 6 }}><input style={cell} value={r.sku} placeholder="—" onChange={(e) => setRow(i, { sku: e.target.value })} /></td>
                      <td style={{ textAlign: "center" }}><input type="checkbox" checked={r.active} onChange={(e) => setRow(i, { active: e.target.checked })} aria-label="Available to buy" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <span style={muted}>Leave stock blank for unlimited. &ldquo;Was&rdquo; shows crossed out next to the price when it&rsquo;s higher. Untick &ldquo;On sale&rdquo; to hide a combination you don&rsquo;t sell.</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Editor rows → the API's options/variants (prices in minor units). Returns an error message instead when something's missing. */
export function variantPayload(options: OptionDraft[], rows: VariantDraft[]): { options: { name: string; values: string[] }[]; variants: unknown[] } | string {
  const usable = options.map((o) => ({ name: o.name.trim(), values: splitValues(o.values) })).filter((o) => o.name || o.values.length > 0);
  if (usable.some((o) => !o.name)) return "Give every option a name (e.g. Size).";
  if (usable.some((o) => o.values.length === 0)) return `Add at least one value for ${usable.find((o) => o.values.length === 0)!.name}.`;
  if (rows.length === 0) return "Add an option with at least one value.";
  const toMinor = (v: string) => Math.round(Number(v) * 100);
  for (const r of rows) {
    if (r.price === "" || !Number.isFinite(Number(r.price)) || Number(r.price) < 0) return `Enter a price for ${Object.values(r.options).join(" / ")}.`;
  }
  return {
    options: usable,
    variants: rows.map((r) => ({
      ...(r.id ? { id: r.id } : {}),
      options: r.options,
      priceMinor: toMinor(r.price),
      compareAtPriceMinor: r.compareAt === "" ? null : toMinor(r.compareAt),
      stockQuantity: r.stock === "" ? null : Math.max(0, Math.trunc(Number(r.stock))),
      sku: r.sku.trim() || null,
      active: r.active,
      ...(r.imageUrl ? { imageUrl: r.imageUrl } : {}),
    })),
  };
}

/** API variants → editor rows. */
export function draftsFromProduct(product: { options?: unknown; variants?: unknown }): { options: OptionDraft[]; rows: VariantDraft[] } {
  const options = Array.isArray(product.options)
    ? (product.options as { name?: string; values?: string[] }[]).map((o) => ({ name: o.name ?? "", values: (o.values ?? []).join(", ") }))
    : [];
  const rows = Array.isArray(product.variants)
    ? (product.variants as { id: string; options: Record<string, string>; priceMinor: number; compareAtPriceMinor?: number | null; stockQuantity?: number | null; sku?: string | null; active?: boolean; imageUrl?: string | null }[]).map((v) => ({
        id: v.id,
        options: v.options ?? {},
        price: String(v.priceMinor / 100),
        compareAt: v.compareAtPriceMinor != null ? String(v.compareAtPriceMinor / 100) : "",
        stock: v.stockQuantity != null ? String(v.stockQuantity) : "",
        sku: v.sku ?? "",
        active: v.active !== false,
        imageUrl: v.imageUrl ?? null,
      }))
    : [];
  return { options, rows };
}
