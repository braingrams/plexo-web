import { NextRequest, NextResponse } from "next/server";
import type { EntityItem } from "electrodb";
import { isAuthorizedAdmin } from "@/server/adminAuth";
import { PublishedDomain, Template } from "@/lib/db/contentEntities";
import { User } from "@/lib/db/coreEntities";

/**
 * GET /api/internal/domains?filter=flagged|suspended|all
 * Review queue for the abuse-scan pipeline (lib/safeBrowsing.ts) — lists domains that
 * came back positive from a Safe Browsing check so a human can decide whether to
 * suspend them via POST /api/internal/domains/:id/suspend.
 *
 * PublishedDomain has no index over `flagged`/`active` (primary is templateId-scoped,
 * GSI1 is byDomain — see contentEntities.ts) — this cross-site admin review queue is a
 * once-in-a-while, low-frequency lookup, so a bounded Scan (filtered in application code)
 * is the honest v1 answer here, same discipline as scan-domains/expire-stale-holds,
 * rather than a third GSI on the busiest entity in the content table for an internal
 * admin page.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorizedAdmin(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const filter = new URL(request.url).searchParams.get("filter") || "flagged";

  type Row = EntityItem<typeof PublishedDomain>;
  const all: Row[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page: { data: Row[]; cursor: string | null } = await PublishedDomain.scan.go({ cursor });
    all.push(...page.data);
    cursor = page.cursor;
    if (!cursor) break;
  }

  const filtered = all
    .filter((d) => {
      if (filter === "suspended") return d.active === false;
      if (filter === "all") return true;
      return (d.flagged ?? false) && (d.active ?? true);
    })
    .sort((a, b) => (b.lastScannedAt ?? "").localeCompare(a.lastScannedAt ?? ""))
    .slice(0, 200);

  const domains = await Promise.all(
    filtered.map(async (d) => {
      const [{ data: user }, { data: template }] = await Promise.all([
        User.get({ id: d.userId }).go(),
        Template.get({ id: d.templateId }).go(),
      ]);
      return { ...d, user: { email: user?.email ?? "" }, template: { name: template?.name ?? "" } };
    }),
  );

  return NextResponse.json({ domains });
}
