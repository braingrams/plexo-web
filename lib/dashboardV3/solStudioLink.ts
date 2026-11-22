/**
 * "Let SOL do it" links. The address is still Ask SOL with the prompt filled in (so opening it in a
 * new tab, or without scripts, still works), but marked `studio=1` so the dashboard opens SOL
 * Studio right where the owner is and SOL starts working at once, instead of sending them away.
 * Only for COMPLETE requests: a prompt the owner is meant to finish typing should stay a plain
 * Ask SOL link (`/dashboard/sol?new=1&draft=…`).
 */
export const SOL_STUDIO_PARAM = "studio";

export function solStudioHref(prompt: string, opts: { siteId?: string | null } = {}): string {
  const site = opts.siteId && /^[A-Za-z0-9_-]{6,80}$/.test(opts.siteId) ? `&site=${encodeURIComponent(opts.siteId)}` : "";
  return `/dashboard/sol?new=1&draft=${encodeURIComponent(prompt.trim().slice(0, 2000))}${site}&${SOL_STUDIO_PARAM}=1`;
}

/** The request behind a studio link, or null for any other link. */
export function parseSolStudioHref(href: string, origin = "http://local"): { prompt: string; siteId: string | null } | null {
  let url: URL;
  try {
    url = new URL(href, origin);
  } catch {
    return null;
  }
  if (url.pathname !== "/dashboard/sol" || url.searchParams.get(SOL_STUDIO_PARAM) !== "1") return null;
  const prompt = (url.searchParams.get("draft") ?? "").trim().slice(0, 2000);
  if (!prompt) return null;
  const site = url.searchParams.get("site");
  return { prompt, siteId: site && /^[A-Za-z0-9_-]{6,80}$/.test(site) ? site : null };
}
