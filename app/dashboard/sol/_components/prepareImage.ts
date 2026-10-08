// The model can only view JPEG/PNG/GIF/WebP images up to ~3.75 MB (see
// lib/ai/solAttachments.ts), but a straight-off-the-phone photo is routinely 4–12 MB and
// sometimes AVIF/HEIC. Rather than make the user resize or convert anything, the composer
// does it before upload: re-encode to JPEG, capped at a long edge the model would downscale
// to anyway, so the visual content SOL sees is unchanged.

const MODEL_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const MAX_BYTES = 3_500_000;
// Claude resizes anything larger than ~1568px on the long edge before looking at it.
const MAX_EDGE = 2000;

export async function prepareImageForModel(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  const supported = MODEL_IMAGE_TYPES.has(file.type);
  // GIFs are left alone when they fit — re-encoding would drop the animation.
  if (supported && file.size <= MAX_BYTES) return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file; // the browser can't decode it either; the server will explain to SOL
  }
  try {
    for (const edge of [MAX_EDGE, 1568, 1200]) {
      const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) return file;
      // JPEG has no transparency — paint white first so transparent PNG areas don't go black.
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
      if (blob && blob.size <= MAX_BYTES) {
        const name = file.name.replace(/\.[^.]+$/, "") || "image";
        return new File([blob], `${name}.jpg`, { type: "image/jpeg", lastModified: file.lastModified });
      }
    }
    return file;
  } finally {
    bitmap.close();
  }
}
