import { normalizeRedirectPath, normalizeRedirectTarget } from "@/lib/redirects/paths";

export type BulkRow = { fromPath: string; toPath: string; permanent: boolean };
export type BulkResult = { rows: BulkRow[]; problems: Array<{ line: number; text: string; reason: string }> };

const MAX_ROWS = 500;

/**
 * Turns pasted lines ("/old, /new" or "/old /new" or "/old -> /new" or "/old\t/new", an optional 301/302 at the end)
 * into redirects, and says in plain words what is wrong with any line that isn't one. A header row from a spreadsheet is skipped.
 */
export function parseBulkRedirects(text: string, defaultPermanent = true): BulkResult {
  const rows: BulkRow[] = [];
  const problems: BulkResult["problems"] = [];
  const seen = new Set<string>();
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const parts = line.split(/\s*(?:->|=>|,|;|\t)\s*|\s+/).filter(Boolean);
    if (i === 0 && /^(from|old|source)/i.test(parts[0] ?? "")) return;
    const code = parts.length >= 3 && /^30[12]$/.test(parts[parts.length - 1]) ? parts.pop()! : null;
    if (parts.length !== 2) return void problems.push({ line: i + 1, text: line, reason: "Put the old address first and the new one second, like /old-page /new-page." });
    const [from, to] = parts;
    if (!from.startsWith("/")) return void problems.push({ line: i + 1, text: line, reason: "The old address must start with a slash, like /old-page." });
    if (!to.startsWith("/") && !/^https?:\/\//i.test(to)) return void problems.push({ line: i + 1, text: line, reason: "The new address must start with a slash, or with https:// for another website." });
    const fromPath = normalizeRedirectPath(from.split(/[?#]/)[0]);
    const toPath = normalizeRedirectTarget(to);
    if (fromPath === toPath) return void problems.push({ line: i + 1, text: line, reason: "A redirect can't send a page to itself." });
    if (seen.has(fromPath)) return void problems.push({ line: i + 1, text: line, reason: "This old address is already in your list above." });
    if (rows.length >= MAX_ROWS) return void problems.push({ line: i + 1, text: line, reason: `Add up to ${MAX_ROWS} at a time. Paste the rest after saving these.` });
    seen.add(fromPath);
    rows.push({ fromPath, toPath, permanent: code ? code === "301" : defaultPermanent });
  });
  return { rows, problems };
}
