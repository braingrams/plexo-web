import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import { resolveUser } from "../domains/route";
import { promises as fs } from "node:fs";
import path from "node:path";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const resolved = await resolveUser(request);
    if (!resolved) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const images = await prisma.uploadedImage.findMany({
      where: { userId: resolved.userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        url: true,
      },
    });

    return NextResponse.json(images);
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

    const image = await prisma.uploadedImage.findUnique({
      where: { id },
    });

    if (!image) {
      return NextResponse.json({ error: "Image not found" }, { status: 404 });
    }

    if (image.userId !== resolved.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    await prisma.uploadedImage.delete({
      where: { id },
    });

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
