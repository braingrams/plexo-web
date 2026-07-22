import dns from "node:dns/promises";
import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "../route";

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

  const baseAppUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const baseDomain = new URL(baseAppUrl).hostname;

  try {
    // 1. Try to resolve CNAME
    const cnames = await dns.resolveCname(domain).catch(() => [] as string[]);
    const hasCname = cnames.some(
      r => r.toLowerCase().endsWith(baseDomain) || r.toLowerCase() === baseDomain
    );
    
    if (hasCname) {
      return NextResponse.json({ valid: true, type: "CNAME", records: cnames });
    }

    // 2. Try resolving A records (for root domains or ANAME/ALIAS records)
    const aRecords = await dns.resolve(domain, "A").catch(() => [] as string[]);
    if (aRecords.length > 0) {
      return NextResponse.json({ valid: true, type: "A", records: aRecords });
    }

    return NextResponse.json({
      valid: false,
      error: `Could not verify CNAME pointing to ${baseDomain} or any A records. Please verify your DNS settings.`,
    });
  } catch (error) {
    return NextResponse.json({
      valid: false,
      error: error instanceof Error ? error.message : "DNS validation failed.",
    });
  }
}
