import { NextRequest, NextResponse } from "next/server";

import { uploadObject, StorageError } from "@/lib/storage";
import { resolveUser } from "@/lib/auth/resolveUser";

// A site owner's own font files for the new editor (its "Add a font" button). Stored in the same public
// bucket as their images so published pages can load them; the file's own name stays out of the URL.
const MAX_FONT_BYTES = 3 * 1024 * 1024;
const FORMATS: Record<string, { type: string; magic: (b: Buffer) => boolean }> = {
  woff2: { type: "font/woff2", magic: (b) => b.subarray(0, 4).toString("latin1") === "wOF2" },
  woff: { type: "font/woff", magic: (b) => b.subarray(0, 4).toString("latin1") === "wOFF" },
  ttf: { type: "font/ttf", magic: (b) => b.readUInt32BE(0) === 0x00010000 || b.subarray(0, 4).toString("latin1") === "true" },
  otf: { type: "font/otf", magic: (b) => b.subarray(0, 4).toString("latin1") === "OTTO" },
};

function randomKey(): string {
  return Array.from({ length: 12 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("");
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const resolved = await resolveUser(request);
    if (!resolved) return NextResponse.json({ error: "Please sign in again to upload a font." }, { status: 401 });

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "Choose a font file to upload." }, { status: 400 });

    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const format = FORMATS[ext];
    if (!format) return NextResponse.json({ error: "That isn't a font file we can use. Upload a .woff2, .woff, .ttf or .otf file." }, { status: 400 });
    if (file.size > MAX_FONT_BYTES) return NextResponse.json({ error: "That font file is over 3 MB. Try a smaller file, or the .woff2 version." }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.length < 12 || !format.magic(buffer)) {
      return NextResponse.json({ error: `That file doesn't look like a real .${ext} font. Check it opens on your computer, then try again.` }, { status: 400 });
    }

    const blob = await uploadObject(`fonts/${resolved.userId}/${randomKey()}.${ext}`, buffer, { access: "public", contentType: format.type });
    return NextResponse.json({ url: blob.url });
  } catch (error) {
    if (error instanceof StorageError) return NextResponse.json({ error: "We couldn't save that font just now. Please try again." }, { status: 500 });
    console.error("Font upload error:", error);
    return NextResponse.json({ error: "Font upload failed. Please try again." }, { status: 500 });
  }
}
