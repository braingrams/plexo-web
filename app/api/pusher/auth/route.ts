import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/server/prisma";
import { resolveUser } from "@/app/api/v1/domains/route";
import { authorizeChannel } from "@/lib/realtime/pusher";

/**
 * Pusher's private-channel auth endpoint (see lib/realtime/pusherClient.ts's
 * authEndpoint). A signed-in user may only subscribe to their own
 * `private-user-{userId}` channel, or a `private-org-{orgId}-template-{templateId}`
 * channel for an org they're actually a member of — this is the actual access-control
 * boundary for realtime comment/notification events, not just a formality.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const form = await request.formData().catch(() => null);
  const socketId = form?.get("socket_id")?.toString();
  const channel = form?.get("channel_name")?.toString();
  if (!socketId || !channel) {
    return NextResponse.json({ error: "Missing socket_id or channel_name." }, { status: 400 });
  }

  if (channel === `private-user-${resolved.userId}`) {
    return NextResponse.json(authorizeChannel(socketId, channel));
  }

  // Org ids are UUIDs (contain hyphens), so a plain split on "-" is ambiguous — match the
  // UUID shape explicitly instead of guessing where the org id ends and template id begins.
  const uuidChannelMatch = channel.match(
    /^private-org-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-template-([0-9a-f-]+)$/i
  );
  if (uuidChannelMatch) {
    const [, organizationId, templateId] = uuidChannelMatch;
    if (organizationId !== resolved.organizationId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const template = await prisma.template.findFirst({
      where: { id: templateId, organizationId },
      select: { id: true },
    });
    if (!template) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json(authorizeChannel(socketId, channel));
  }

  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
