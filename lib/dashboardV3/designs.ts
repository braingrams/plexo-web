// Plain-words helpers for the Designs screens (browse, my listings, earnings) on the new dashboard.

export type DesignKind = "EMAIL" | "LANDING_PAGE";

/** What a design is, in the words an owner uses. */
export function designKindLabel(kind: DesignKind | string): string {
  return kind === "EMAIL" ? "Email" : "Web page";
}

/** "Free" or "$12.50". */
export function designPrice(priceCents: number): string {
  return priceCents > 0 ? `$${(priceCents / 100).toFixed(2)}` : "Free";
}

export type ListingTone = "success" | "warning" | "danger" | "neutral";

/** How a listing is doing, with what it means and what to do next. */
export function listingStatus(status: string | null | undefined): { label: string; tone: ListingTone; hint: string } {
  switch (status) {
    case "PUBLISHED":
      return { label: "For sale", tone: "success", hint: "People can find and use it now." };
    case "PENDING_REVIEW":
      return { label: "Being checked", tone: "warning", hint: "We are looking it over. It goes on sale as soon as it is approved." };
    case "REJECTED":
      return { label: "Not approved", tone: "danger", hint: "Fix what is mentioned below, then list it again." };
    default:
      return { label: "Draft", tone: "neutral", hint: "Not on sale yet." };
  }
}

/** "20" for 2000 basis points; "2.50" keeps its decimals. */
export function percentFromBps(bps: number): string {
  return (bps / 100).toFixed(bps % 100 === 0 ? 0 : 2);
}

/** What the platform keeps and what the seller keeps, as percentages in plain text. */
export function feeSplit(feeBps: number): { fee: string; keep: string } {
  return { fee: percentFromBps(feeBps), keep: percentFromBps(10_000 - feeBps) };
}

/** Where the Designs list goes with the given filters (empty and default values are left out). */
export function designsHref(params: { category?: string; kind?: string; free?: string; q?: string; sort?: string; page?: number | string }): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "" || v === "all") continue;
    if (k === "sort" && v === "latest") continue;
    if (k === "page" && Number(v) <= 1) continue;
    q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `/dashboard/marketplace?${s}` : "/dashboard/marketplace";
}

/** Where to take someone once they own a design and have made their copy. */
export function afterUseHref(templateId: string, kind: DesignKind | string | null | undefined): string {
  return kind === "EMAIL" ? `/dashboard/templates/${templateId}` : `/dashboard/sites/${templateId}`;
}

/** The plain-words payout status. */
export function payoutStatus(status: string | null | undefined): { label: string; tone: ListingTone } {
  switch (status) {
    case "PROCESSED":
      return { label: "Paid", tone: "success" };
    case "REJECTED":
      return { label: "Not paid", tone: "danger" };
    default:
      return { label: "On its way", tone: "warning" };
  }
}
