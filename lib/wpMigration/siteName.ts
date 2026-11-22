export function cleanWpSiteName(rawName: string | undefined, origin: string): string {
  const hostFallback = (() => {
    try {
      const host = new URL(origin).hostname.replace(/^www\./, "");
      const base = host.split(".")[0];
      return base ? base.charAt(0).toUpperCase() + base.slice(1) : host;
    } catch {
      return "WordPress site";
    }
  })();
  if (!rawName || !rawName.trim()) return hostFallback;
  const cleaned = rawName.split(/\s+[|\-–—:]\s+/)[0]?.trim();
  if (!cleaned || cleaned.toLowerCase() === "home" || cleaned.toLowerCase() === "untitled") return hostFallback;
  return cleaned;
}
