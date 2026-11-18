import { CURRENT_SITE_COOKIE } from "@/lib/dashboardV3/sites";

/** The dashboard's current-site cookie in the browser (a hint for SOL, never a decision). undefined when absent. */
export function readCurrentSiteCookie(cookieString?: string): string | undefined {
  const raw = cookieString ?? (typeof document !== "undefined" ? document.cookie : "");
  const hit = raw.split(/;\s*/).find((c) => c.startsWith(`${CURRENT_SITE_COOKIE}=`));
  if (!hit) return undefined;
  try {
    const v = decodeURIComponent(hit.slice(CURRENT_SITE_COOKIE.length + 1));
    return /^[A-Za-z0-9_-]{6,80}$/.test(v) ? v : undefined;
  } catch {
    return undefined;
  }
}
