import type { DesignSystem } from "@charisol/plexo-sdk/v2/compile";
import type { DesignSystemRef } from "@/lib/v2/design";

// The browser's half of a big brand: putting it straight into storage and taking it straight back out, so its size is never
// limited by what one request to Plexo's server can carry. (The server half: lib/v2/designSystemStore.ts and
// app/api/templates/design-system/route.ts.)

/** At or below this many characters of JSON a brand just travels with the page; above it, it goes to storage and the page keeps a reference. */
export const BRAND_EMBED_MAX_CHARS = 600_000;

const toHex = (buf: ArrayBuffer): string => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function gzip(text: string): Promise<Blob> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(stream).blob();
}

async function gunzip(blob: Blob): Promise<string> {
  return new Response(blob.stream().pipeThrough(new DecompressionStream("gzip"))).text();
}

export class BrandTransferError extends Error {}

/** Gzips the brand, uploads it straight to storage (skipped when that exact content is already there) and returns the reference to save. */
export async function uploadBrand(ds: DesignSystem, fetchFn: typeof fetch = fetch): Promise<DesignSystemRef> {
  const json = JSON.stringify(ds);
  const gz = await gzip(json);
  const hash = toHex(await crypto.subtle.digest("SHA-256", await gz.arrayBuffer()));
  const res = await fetchFn("/api/templates/design-system", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hash, size: gz.size }) });
  const answer = (await res.json().catch(() => ({}))) as { stored?: boolean; url?: string; fields?: Record<string, string>; error?: string };
  if (!res.ok) throw new BrandTransferError(answer.error ?? "Couldn't save this site's colours and fonts. Your changes are still here, so try again.");
  if (!answer.stored) {
    if (!answer.url || !answer.fields) throw new BrandTransferError("Couldn't prepare the upload. Please try again.");
    const form = new FormData();
    for (const [k, v] of Object.entries(answer.fields)) form.append(k, v);
    form.append("file", new Blob([gz], { type: "application/gzip" }), `${hash}.json.gz`); // the file part must come last
    let up: Response;
    try {
      up = await fetchFn(answer.url, { method: "POST", body: form });
    } catch {
      throw new BrandTransferError("Couldn't upload this site's colours and fonts. Check your connection and try again.");
    }
    if (!up.ok) throw new BrandTransferError("Couldn't upload this site's colours and fonts. Please try again.");
  }
  return { hash, size: json.length };
}

/** Fetches a stored brand straight from storage (the link comes from the server when the page is opened). */
export async function fetchBrand(url: string, fetchFn: typeof fetch = fetch): Promise<DesignSystem> {
  let res: Response;
  try {
    res = await fetchFn(url);
  } catch {
    throw new BrandTransferError("Couldn't load this site's colours and fonts. Check your connection and try again.");
  }
  if (!res.ok) throw new BrandTransferError("Couldn't load this site's colours and fonts. Reload the page to try again.");
  let ds: unknown;
  try {
    ds = JSON.parse(await gunzip(await res.blob()));
  } catch {
    throw new BrandTransferError("This site's saved colours and fonts couldn't be read. Reload the page to try again.");
  }
  if (!ds || typeof ds !== "object" || !Array.isArray((ds as DesignSystem).tokens)) throw new BrandTransferError("This site's saved colours and fonts aren't in the right shape.");
  return ds as DesignSystem;
}
