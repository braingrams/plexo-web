// Tenant-published content (subdomains + attached custom domains) is served from a
// domain dedicated to that purpose, distinct from the dashboard's own registrable
// domain (NEXT_PUBLIC_APP_URL). This is what actually isolates tenant cookies/session
// state from the main app — a cookie scoped to `.plexo.xyz` would otherwise be sent to
// every `*.plexo.xyz` tenant subdomain regardless of code-level auth checks, since that
// scoping happens at the browser/eTLD+1 level, not in app code.
//
// Set NEXT_PUBLIC_PAGES_DOMAIN in every environment (e.g. "plexopages.io"). See the
// setup notes in this repo's domain-publishing plan for the DNS + Vercel steps.
export function getPagesDomain(): string {
  const raw = process.env.NEXT_PUBLIC_PAGES_DOMAIN;
  if (raw && raw.trim()) return raw.trim().toLowerCase();

  // Fallback only — puts tenant content back under the dashboard's own domain, which
  // reintroduces the cookie-scoping risk this file exists to avoid. Configure
  // NEXT_PUBLIC_PAGES_DOMAIN before deploying to any real environment.
  const baseAppUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return new URL(baseAppUrl).hostname;
}
