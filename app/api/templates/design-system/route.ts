import { NextRequest, NextResponse } from "next/server";

import { resolveUser } from "@/lib/auth/resolveUser";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { MAX_STORED_DESIGN_SYSTEM_BYTES, designSystemExists, presignDesignSystemUpload } from "@/lib/v2/designSystemStore";

/**
 * POST /api/templates/design-system   { hash, size }
 *
 * A big brand (a design system with thousands of tokens) can be larger than a single request can carry, so the editor puts it
 * straight into storage instead: it gzips the brand, hashes the bytes (sha-256) and asks here for permission to upload that
 * exact object. Answers { stored: true } when it's already there (nothing to upload), or { url, fields } for a one-off upload form
 * limited to that name, type and size. The page is then saved with only the small reference ({ hash, size }), and the server
 * checks the object really is there and readable before it accepts the save (lib/v2/designSystemStore.ts).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const permissionError = requirePermission(resolved.role, { template: ["update"] });
  if (permissionError) return permissionError;

  const body = (await request.json().catch(() => null)) as { hash?: unknown; size?: unknown } | null;
  const hash = typeof body?.hash === "string" ? body.hash : "";
  const size = Number(body?.size);
  if (!/^[a-f0-9]{64}$/.test(hash) || !Number.isFinite(size) || size < 1) {
    return NextResponse.json({ error: "That upload wasn't set up correctly. Please try saving again." }, { status: 400 });
  }
  if (size > MAX_STORED_DESIGN_SYSTEM_BYTES) {
    return NextResponse.json({ error: "This site's colours and fonts are larger than Plexo can store. Remove unused colours or components in Branding." }, { status: 413 });
  }
  try {
    if (await designSystemExists(hash)) return NextResponse.json({ stored: true });
    return NextResponse.json(await presignDesignSystemUpload(hash));
  } catch {
    return NextResponse.json({ error: "Couldn't prepare the upload right now. Please try saving again in a moment." }, { status: 503 });
  }
}
