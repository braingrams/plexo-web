/**
 * Two ways to tell "a visitor filled in a form" from "a machine knocked on the door", so only the first ever reaches the owner's inbox.
 *
 *  1. Machine calls from WordPress plugins and services. A site moved from WordPress keeps getting signed calls from the services that
 *     watched the old one (MalCare/BlogVault, backup and monitoring tools). They look like a form with a pile of odd fields, and no
 *     verification box or hidden trap can stop them because they never use the page. They are recognised by what they carry.
 *  2. Posts with no sign of a browser. A real browser always says where a form was sent from (an Origin, a Referer or a Sec-Fetch-Site
 *     of this site). A server posting straight to a page says nothing.
 */

const MACHINE_KEYS: Array<{ re: RegExp; source: string }> = [
  { re: /^(bv(prms|plugname|method|time|version|b64|b64resp|reqmerge|prmsmac)|bvprms bv \d+|bv_?(sig|pubkey))$/i, source: "MalCare / BlogVault" },
  { re: /^(sighshalgo|sersafe|memset|aftershutdown)$/i, source: "MalCare / BlogVault" },
  { re: /^(mwp_|worker_|_wpvivid|updraft_|wfsn|jetpack[_-]|wpr_|ithemes_|wp_?mail_?smtp_)/i, source: "a WordPress plugin" },
];

/** What kind of machine sent these answers (so it can be left out and named), or null when it looks like a person's form. */
export function machineSource(fields: Record<string, unknown>): string | null {
  const keys = Object.keys(fields);
  for (const k of keys) {
    const hit = MACHINE_KEYS.find((m) => m.re.test(k.trim()));
    if (hit) return hit.source;
  }
  // A signed call: a public key and a signature, which no ordinary form has.
  const lower = new Set(keys.map((k) => k.trim().toLowerCase()));
  if (lower.has("sig") && lower.has("pubkey")) return "a signed service call";
  const values = Object.values(fields).map((v) => String(v).toLowerCase());
  if (values.includes("malcare") || values.includes("blogvault")) return "MalCare / BlogVault";
  return null;
}

type HeaderBag = { get(name: string): string | null };

const hostOf = (value: string | null): string | null => {
  if (!value || value === "null") return null;
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
};

/** True when the post carries some sign it came from a browser on this site: Sec-Fetch-Site, or an Origin or Referer naming this site. */
export function looksLikeBrowserPost(headers: HeaderBag, siteHost: string): boolean {
  const fetchSite = (headers.get("sec-fetch-site") ?? "").toLowerCase();
  if (fetchSite === "same-origin" || fetchSite === "same-site") return true;
  const mine = siteHost.split(":")[0].replace(/^www\./, "").toLowerCase();
  return [hostOf(headers.get("origin")), hostOf(headers.get("referer"))].some((h) => h !== null && h.toLowerCase() === mine);
}
