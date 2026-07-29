import dns from "node:dns/promises";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import { resolveUser } from "../route";
import { getPagesDomain } from "@/server/pagesDomain";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const domain = searchParams.get("domain")?.trim().toLowerCase();

  if (!domain) {
    return NextResponse.json({ error: "Domain parameter is required." }, { status: 400 });
  }

  // Tenant content (subdomains + custom domains) always resolves to the pages domain,
  // never the dashboard's own app domain — see server/pagesDomain.ts.
  const pagesDomain = getPagesDomain();

  const record = await prisma.publishedDomain.findFirst({
    where: { domain, userId: resolved.userId },
  });
  if (!record) {
    return NextResponse.json({ error: "Domain not found or unauthorized." }, { status: 404 });
  }

  const respond = async (result: { valid: boolean; type?: string; records?: string[]; error?: string }) => {
    // Persist the outcome so the frontend doesn't lose "Verified" on reload — previously
    // this endpoint only ever returned a result without writing it anywhere.
    await prisma.publishedDomain.update({
      where: { id: record.id },
      data: {
        dnsVerified: result.valid,
        dnsVerifiedAt: result.valid ? new Date() : record.dnsVerifiedAt,
      },
    });
    return NextResponse.json(result);
  };

  try {
    // 1. Try to resolve CNAME
    const cnames = await dns.resolveCname(domain).catch(() => [] as string[]);
    const hasCname = cnames.some(
      r => r.toLowerCase().endsWith(pagesDomain) || r.toLowerCase() === pagesDomain
    );

    if (hasCname) {
      return await respond({ valid: true, type: "CNAME", records: cnames });
    }

    // 2. Try resolving A records (for root domains or ANAME/ALIAS records)
    const aRecords = await dns.resolve(domain, "A").catch(() => [] as string[]);
    if (aRecords.length > 0) {
      return await respond({ valid: true, type: "A", records: aRecords });
    }

    return await respond({
      valid: false,
      error: `Could not verify CNAME pointing to ${pagesDomain} or any A records. Please verify your DNS settings.`,
    });
  } catch (error) {
    return await respond({
      valid: false,
      error: error instanceof Error ? error.message : "DNS validation failed.",
    });
  }
}
