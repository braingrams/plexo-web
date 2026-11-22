import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { Template } from "@/lib/db/contentEntities";

/** The signed-in person's own site (the top page of it), or the plain-words error response to send back. */
export async function authorizeSite(request: NextRequest, siteId: string) {
  const resolved = await resolveUser(request);
  if (!resolved) return { error: NextResponse.json({ error: "Sign in to Plexo to continue." }, { status: 401 }) } as const;
  const { data: site } = await Template.get({ id: siteId }).go();
  if (!site || site.organizationId !== resolved.organizationId || site.parentId || site.kind !== "LANDING_PAGE") {
    return { error: NextResponse.json({ error: "Site not found." }, { status: 404 }) } as const;
  }
  return { site, user: resolved } as const;
}
