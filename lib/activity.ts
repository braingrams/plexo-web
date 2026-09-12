// Maps a request path to a short, human label for User.lastActiveContext — so plexo-admin's
// Users pages can show "Generated content with AI · 2h ago" instead of a bare timestamp.
// Ordered most-specific-prefix-first; first match wins.
const ROUTE_LABELS: Array<[string, string]> = [
  ["/api/v1/ai/generate", "Generated content with AI"],
  ["/api/v1/compile", "Compiled a page"],
  ["/api/v1/validate-key", "Validated an API key"],
  ["/api/v1/marketplace/withdrawals", "Requested a marketplace withdrawal"],
  ["/api/v1/marketplace", "Used the marketplace"],
  ["/api/v1/domains", "Managed a domain"],
  ["/api/v1/templates", "Edited a site"],
  ["/api/v1/commerce", "Used Commerce"],
  ["/api/v1/funnels", "Used Funnels"],
];

export function describeActivity(pathname: string): string {
  for (const [prefix, label] of ROUTE_LABELS) {
    if (pathname.startsWith(prefix)) return label;
  }
  return pathname.startsWith("/api/v1") ? "Used the Plexo API" : "Used the dashboard";
}
