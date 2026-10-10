import { SCAFFOLD_FILES } from "./files.generated";
import { escapeHtmlAttr } from "@/lib/pub/htmlInject";

export { SCAFFOLD_FILES };

/** The starter files for a new project, personalised with its name. */
export function scaffoldFiles(appName: string): Record<string, string> {
  const files = { ...SCAFFOLD_FILES };
  const name = appName.trim() || "My Plexo App";
  files["index.html"] = files["index.html"].replace("<title>My Plexo App</title>", `<title>${escapeHtmlAttr(name)}</title>`);
  const pkg = JSON.parse(files["package.json"]);
  pkg.name = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "plexo-app";
  files["package.json"] = `${JSON.stringify(pkg, null, 2)}\n`;
  files["public/favicon.svg"] = appIcon(name);
  return files;
}

// Gradient pairs for a new app's own icon — the owner's site, not Plexo's UI, so a range of
// colours. Picked from the name, so an app always gets the same one.
const ICON_COLOURS: Array<[string, string]> = [
  ["#6366f1", "#8b5cf6"],
  ["#0ea5e9", "#2563eb"],
  ["#10b981", "#0d9488"],
  ["#f59e0b", "#ea580c"],
  ["#ec4899", "#be185d"],
  ["#ef4444", "#b91c1c"],
  ["#14b8a6", "#0891b2"],
  ["#a855f7", "#6d28d9"],
  ["#f97316", "#dc2626"],
  ["#22c55e", "#15803d"],
];

/** The browser-tab icon a new app starts with: its own first letter on its own colours, so a
 *  tab reads as this app (not a generic Plexo "P") before SOL designs a proper mark. */
export function appIcon(appName: string): string {
  const name = appName.trim();
  // FNV-1a: spreads similar names across the colours (a plain ×31 hash bunched them up).
  let hash = 0x811c9dc5;
  for (const ch of name.toLowerCase()) hash = Math.imul(hash ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  const [from, to] = ICON_COLOURS[hash % ICON_COLOURS.length];
  const letter = (name.match(/[\p{L}\p{N}]/u)?.[0] ?? "A").toUpperCase();
  const safe = letter.replace(/[<>&"']/g, "");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="32" height="32" rx="8" fill="url(#g)"/><text x="16" y="22.5" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif" font-size="18" font-weight="700" fill="#fff">${safe}</text></svg>\n`;
}
