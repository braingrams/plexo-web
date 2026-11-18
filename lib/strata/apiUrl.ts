/** Strata's API root including the version (STRATA_API_URL, e.g. https://api.strata.charisol.io/v1). No imports: safe from anywhere, including the page-serving path. */
export function strataApiUrl(): string | null {
  const url = process.env.STRATA_API_URL?.trim().replace(/\/+$/, "");
  return url || null;
}
