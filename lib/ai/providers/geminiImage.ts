import { GoogleGenAI } from "@google/genai";

const MODEL = "imagen-4.0-generate-001";

export class ImageGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageGenerationError";
  }
}

/** Generates a single image from a text prompt via Google's Imagen API — the only
 * text-to-image call site in the app (everything else is stock-photo search or manual
 * upload). Returns the raw image bytes + the mime type Imagen actually produced, ready to
 * hand straight to @vercel/blob's put() the same way upload-image/route.ts does. */
export async function generateImage({ apiKey, prompt }: { apiKey: string; prompt: string }): Promise<{ bytes: Buffer; mimeType: string }> {
  const client = new GoogleGenAI({ apiKey });

  const response = await client.models.generateImages({
    model: MODEL,
    prompt,
    config: { numberOfImages: 1 },
  });

  const image = response.generatedImages?.[0]?.image;
  if (!image?.imageBytes) {
    throw new ImageGenerationError("Imagen returned no image data.");
  }

  return {
    bytes: Buffer.from(image.imageBytes, "base64"),
    mimeType: image.mimeType || "image/png",
  };
}
