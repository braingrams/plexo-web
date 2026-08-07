import { GoogleGenAI, Modality } from "@google/genai";

// Google's standalone Imagen API (client.models.generateImages, "imagen-4.0-generate-001")
// stopped accepting new callers and is being sunset — generation now goes through the
// Gemini multimodal model family instead ("Nano Banana"/Gemini image generation) via the
// ordinary generateContent call, requesting an IMAGE response modality.
const MODEL = "gemini-3.1-flash-image";

export class ImageGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageGenerationError";
  }
}

/** Generates a single image from a text prompt via Gemini's native image generation — the
 * only text-to-image call site in the app (everything else is stock-photo search or manual
 * upload). Returns the raw image bytes + the mime type actually produced, ready to hand
 * straight to @vercel/blob's put() the same way upload-image/route.ts does. */
export async function generateImage({ apiKey, prompt }: { apiKey: string; prompt: string }): Promise<{ bytes: Buffer; mimeType: string }> {
  const client = new GoogleGenAI({ apiKey });

  const response = await client.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: { responseModalities: [Modality.IMAGE] },
  });

  const imagePart = response.candidates?.[0]?.content?.parts?.find((part) => part.inlineData?.data);
  const inlineData = imagePart?.inlineData;
  if (!inlineData?.data) {
    throw new ImageGenerationError("Gemini returned no image data.");
  }

  return {
    bytes: Buffer.from(inlineData.data, "base64"),
    mimeType: inlineData.mimeType || "image/png",
  };
}
