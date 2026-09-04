import { NextRequest, NextResponse } from "next/server";
import { resolveUser as resolveUserDynamo } from "@/lib/auth/resolveUser";
import { resolveRegistrarProvider } from "@/lib/domains/registrarProvider";
import { PublishedDomain } from "@/lib/db/contentEntities";

// Every TLD Plexo offers a search result for, in priority order — route53DomainsProvider's
// own SUPPORTED_TLDS is the authority on which of these actually get "instant setup" vs
// routing to manual fulfillment (resolveRegistrarProvider below decides that per-candidate,
// not this list).
const CANDIDATE_TLDS = ["com", "co", "io", "studio", "shop", "xyz", "dev", "app", "online", "store", "ai"];

// A bare label ("acmestudio") — checked against every CANDIDATE_TLDS entry.
const LABEL_REGEX = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
// A full domain-style input ("owanbe.com.ng") — real registrar search boxes accept this
// too, checking that exact domain in addition to the candidate list built from its first
// label, rather than rejecting it outright for containing a dot.
const FULL_DOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

/**
 * GET /api/v1/domains/search?q=acmestudio
 *
 * Powers the "Buy a domain" search step in app/dashboard/domains/domains-client.tsx: checks
 * live availability + pricing for a fixed set of candidate TLDs against the searched name.
 * Deliberately read-only (no RegisteredDomain rows created here) — creation happens at
 * purchase time (POST /api/v1/domains/purchase), same read/write split
 * app/api/v1/domains/route.ts already established for PublishedDomain.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUserDynamo(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const query = (searchParams.get("q") ?? "").trim().toLowerCase();

  let name: string;
  let explicitDomain: string | null = null;
  if (query.includes(".")) {
    if (!FULL_DOMAIN_REGEX.test(query)) {
      return NextResponse.json({ error: "Enter a domain name using letters, numbers, hyphens, and dots only." }, { status: 400 });
    }
    explicitDomain = query;
    name = query.split(".")[0];
  } else {
    if (!query || !LABEL_REGEX.test(query)) {
      return NextResponse.json({ error: "Enter a domain name using letters, numbers, and hyphens only." }, { status: 400 });
    }
    name = query;
  }

  const candidates = CANDIDATE_TLDS.map((tld) => `${name}.${tld}`);
  if (explicitDomain && !candidates.includes(explicitDomain)) candidates.push(explicitDomain);

  const results = await Promise.all(
    candidates.map(async (domain) => {
      try {
        const { kind, provider } = await resolveRegistrarProvider(domain);
        const [[availability], price] = await Promise.all([
          provider.checkAvailability([domain]),
          provider.getPrice(domain).catch(() => null),
        ]);
        return {
          domain,
          registrarKind: kind,
          available: availability.available,
          registrationPriceUsdCents: price?.registrationPriceUsdCents ?? null,
          renewalPriceUsdCents: price?.renewalPriceUsdCents ?? null,
        };
      } catch (err) {
        return {
          domain,
          registrarKind: "ROUTE53" as const,
          available: false,
          registrationPriceUsdCents: null,
          renewalPriceUsdCents: null,
          error: err instanceof Error ? err.message : "Lookup failed.",
        };
      }
    }),
  );

  // A domain already connected on Plexo (bought here earlier, or manually connected by
  // anyone) can never be "available" regardless of what the registrar says — cross-check
  // against the same byDomain hot-path lookup app/api/v1/domains/route.ts's own POST uses.
  const alreadyTaken = await Promise.all(
    results.filter((r) => r.available).map((r) => PublishedDomain.query.byDomain({ domain: r.domain }).go()),
  );
  const takenDomains = new Set(alreadyTaken.flatMap((batch) => batch.data.map((d) => d.domain)));

  return NextResponse.json({
    results: results.map((r) => (takenDomains.has(r.domain) ? { ...r, available: false } : r)),
  });
}
