import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";

import { UploadedImage } from "@/lib/db/coreEntities";
import { resolveUser } from "@/lib/auth/resolveUser";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const resolved = await resolveUser(request);
    if (!resolved) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: images } = await UploadedImage.query
      .byUser({ userId: resolved.userId })
      .go({ order: "desc" });

    return NextResponse.json(images.map((img) => ({ id: img.id, name: img.name, url: img.url })));
  } catch (error) {
    console.error("Failed to list media:", error);
    return NextResponse.json({ error: "Failed to list media" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  try {
    const resolved = await resolveUser(request);
    if (!resolved) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Image ID is required" }, { status: 400 });
    }

    // UploadedImage's primary key is organizationId+id — the caller only has the bare id,
    // so resolve it via the byUser GSI1 (userId is already scoped to the requester, and the
    // per-user image count is small) rather than a table-wide Scan.
    const { data: images } = await UploadedImage.query.byUser({ userId: resolved.userId }).go();
    const image = images.find((img) => img.id === id);

    if (!image) {
      return NextResponse.json({ error: "Image not found" }, { status: 404 });
    }

    if (image.userId !== resolved.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    await UploadedImage.remove({ organizationId: image.organizationId, id: image.id }).go();

    try {
      if (image.url.startsWith("/uploads/")) {
        const filePath = path.join(process.cwd(), "public", image.url);
        await fs.unlink(filePath);
      }
    } catch (fsErr) {
      console.warn(`Failed to delete media file from disk: ${image.url}`, fsErr);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete media:", error);
    return NextResponse.json({ error: "Failed to delete media" }, { status: 500 });
  }
}
