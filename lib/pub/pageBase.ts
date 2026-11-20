/**
 * Does a served page need a `<base href>` so its relative file links (style.css, images/a.png) work? Only a page of your own
 * code that sits below the home page and carries files of its own does. A page that started as blocks has none: its links are
 * written as "/about" or "#pricing", and a base would turn "#pricing" into a trip to another address.
 */
export function needsPageBase(page: { id: string; sourceType?: string | null; convertedFromBlocksAt?: string | null }, siteRootId: string): boolean {
  return page.id !== siteRootId && page.sourceType === "RAW_UPLOAD" && !page.convertedFromBlocksAt;
}
