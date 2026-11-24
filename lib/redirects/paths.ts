/** Canonical form of a redirect's old address: leading slash, no trailing slash. */
export function normalizeRedirectPath(path: string): string {
  return "/" + path.replace(/^\/+/, "").replace(/\/+$/, "");
}

/** A redirect's destination may also be another website; anything else is normalised like an old address. */
export function normalizeRedirectTarget(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return normalizeRedirectPath(path);
}
