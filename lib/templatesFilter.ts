/** The filter tabs on the classic list, and which one a `?filter=` link opens on. */
export type TemplatesFilter = "ALL" | "EMAIL" | "LANDING_PAGE" | "FUNNEL";

export function parseTemplatesFilter(value: string | string[] | null | undefined): TemplatesFilter {
  const v = (Array.isArray(value) ? value[0] : value)?.toUpperCase();
  return v === "EMAIL" || v === "LANDING_PAGE" || v === "FUNNEL" ? v : "ALL";
}
