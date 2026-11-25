/**
 * What the browser may tell the server about SOL's part of a personalized design (SOL's words by number, the sections it chose to
 * remove, the kind of business, whether the owner gave contact details). Only this small recipe is ever sent, never design JSON: the server
 * rebuilds the design from the marketplace listing (lib/onboarding/designEdit.ts). Pure, so both the personalize route and the
 * create route read it the same way.
 */
import { normalizeHex } from "@/lib/dashboardV3/brandLook";

export type SolPart = { copy?: Record<string, string>; remove?: string[]; domain?: string; contact?: boolean; slotsKey?: string };

const MAX_COPY_ENTRIES = 300;
const MAX_COPY_CHARS = 600;

export function parseSolPart(raw: unknown): SolPart {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const r = raw as Record<string, unknown>;
  const copy: Record<string, string> = {};
  if (r.copy && typeof r.copy === "object" && !Array.isArray(r.copy)) {
    for (const [k, v] of Object.entries(r.copy as Record<string, unknown>)) {
      if (Object.keys(copy).length >= MAX_COPY_ENTRIES) break;
      if (/^\d{1,4}$/.test(k) && typeof v === "string" && v.trim()) copy[k] = v.trim().slice(0, MAX_COPY_CHARS);
    }
  }
  const remove = Array.isArray(r.remove) ? (r.remove as unknown[]).filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 120).slice(0, 6) : [];
  const domain = typeof r.domain === "string" && /^[\w-]{1,40}$/.test(r.domain.trim()) ? r.domain.trim() : undefined;
  const slotsKey = typeof r.slotsKey === "string" && /^[a-f0-9]{8,64}$/.test(r.slotsKey) ? r.slotsKey : undefined;
  return { ...(Object.keys(copy).length ? { copy } : {}), ...(remove.length ? { remove } : {}), ...(domain ? { domain } : {}), ...(r.contact === true ? { contact: true } : {}), ...(slotsKey ? { slotsKey } : {}) };
}

/** The brand colours as the Brand page keeps them (#RRGGBB, main first), from whatever the browser sent. */
export function cleanColors(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: string[] = [];
  for (const c of list) {
    const hex = normalizeHex(c);
    if (hex && !out.includes(hex)) out.push(hex);
    if (out.length === 6) break;
  }
  return out;
}

export const cleanLogo = (raw: unknown): string | undefined => (typeof raw === "string" && /^https?:\/\/\S{1,2000}$/i.test(raw.trim()) ? raw.trim() : undefined);
