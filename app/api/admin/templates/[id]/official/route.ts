import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";

/**
 * PATCH /api/admin/templates/[id]/official
 *
 * Toggles Template.isOfficial — the only way a template becomes part of the genuinely public
 * catalog served by /api/v1/public-templates. Gated by a simple email allowlist (ADMIN_EMAILS,
 * comma-separated) rather than a full admin-role system: there's no admin/role concept anywhere
 * in this app today, and this is meant for curating a small handful of official templates, not
 * running a self-serve moderation queue.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    const sessionEmail = session?.user?.email?.toLowerCase().trim();

    if (!sessionEmail) {
      return NextResponse.json({ error: "Unauthorized: no active session." }, { status: 401 });
    }

    const allowlist = (process.env.ADMIN_EMAILS || "")
      .split(",")
      .map((e) => e.toLowerCase().trim())
      .filter(Boolean);

    if (allowlist.length === 0 || !allowlist.includes(sessionEmail)) {
      return NextResponse.json({ error: "Forbidden: this account is not authorized to curate official templates." }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json().catch(() => null);

    if (!body || typeof body.isOfficial !== "boolean") {
      return NextResponse.json({ error: "Body must include a boolean `isOfficial`." }, { status: 400 });
    }

    const existing = await prisma.template.findUnique({ where: { id }, select: { id: true, name: true, isOfficial: true } });
    if (!existing) {
      return NextResponse.json({ error: "Template not found." }, { status: 404 });
    }

    const updated = await prisma.template.update({
      where: { id },
      data: { isOfficial: body.isOfficial },
      select: { id: true, name: true, isOfficial: true },
    });

    return NextResponse.json({ success: true, template: updated });
  } catch (error: any) {
    console.error("[Plexo Web Admin Templates Error]:", error);
    return NextResponse.json({ error: error.message || "Failed to update template." }, { status: 500 });
  }
}
