import { NextRequest, NextResponse } from "next/server";

/** Where the owner lands after connecting (or failing to): the Visits tab of that site, with a plain-words result. */
export function backTo(request: NextRequest, siteId: string, result: string): NextResponse {
  return NextResponse.redirect(new URL(`/dashboard/sites/${siteId}?tab=visits&ga=${result}`, request.url));
}
