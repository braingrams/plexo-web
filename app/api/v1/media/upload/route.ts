import { join } from "path";
import { writeFile, mkdir } from "fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import { resolveUser } from "../../domains/route";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const resolved = await resolveUser(request);
    if (!resolved) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    // Safe filename to avoid directory traversal
    const safeFilename = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
    const uniqueFilename = `${Date.now()}-${safeFilename}`;

    const userId = resolved.userId;
    // Local directory path inside public/uploads
    const uploadDir = join(process.cwd(), "public", "uploads", userId);
    await mkdir(uploadDir, { recursive: true });

    const filePath = join(uploadDir, uniqueFilename);
    await writeFile(filePath, buffer);

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "";
    const fileUrl = `${appUrl}/uploads/${userId}/${uniqueFilename}`;

    // Store in DB
    const uploadedImage = await prisma.uploadedImage.create({
      data: {
        userId,
        name: file.name,
        url: fileUrl,
      },
    });

    return NextResponse.json({
      id: uploadedImage.id,
      name: uploadedImage.name,
      url: uploadedImage.url,
    });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
