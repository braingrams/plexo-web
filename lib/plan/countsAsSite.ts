// What counts against a plan's "how many sites" limit: a site's own top-level page. The rows Plexo adds to run a site (its shared
// header and footer, its blog / shop / course page designs) never count, or every new site would quietly use up several slots.
type Row = { parentId?: string | null; kind?: string; isSiteLayoutFragment?: boolean | null; isBlogLayout?: boolean | null; isCommerceLayout?: boolean | null; isLmsPageDesign?: boolean | null };

export const isSupportRow = (t: Row): boolean => !!(t.isSiteLayoutFragment || t.isBlogLayout || t.isCommerceLayout || t.isLmsPageDesign);

/** A top-level site (or email) of the given kind that counts toward the plan's limit. */
export const countsAsSite = (t: Row, kind: "LANDING_PAGE" | "EMAIL" = "LANDING_PAGE"): boolean => !t.parentId && t.kind === kind && !isSupportRow(t);
