import { readObject } from "@/lib/storage";
import { resolveModel } from "@/lib/ai/modelRegistry";
import { TOOL_CAPABLE_PROVIDERS } from "@/lib/ai/solAgent";
import type { AiProvider } from "@/lib/ai/types";

// One short line under each image the user attaches to a SOL chat, saying what's in it.
// SOL's own reply sees the image too, but asking it for a description there would mean
// another round with the whole conversation — instead each image gets one small call on
// the provider's cheapest model (~1,600 tokens to look at a photo, ~40 to describe it),
// alongside the reply rather than before it, so nobody waits for it.

const MODEL_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const MAX_IMAGE_BYTES = 3_750_000;
const PROMPT =
  "Describe what this image shows in one short, plain sentence (at most 20 words) — like a caption under a photo. No preamble, no quotes.";

export interface ImageDescriptions {
  /** Stored attachment URL → its description. */
  byUrl: Map<string, string>;
  usage: { inputTokens: number; outputTokens: number };
}

function tidy(text: string): string {
  const line = text.replace(/\s+/g, " ").trim().replace(/^["“]|["”]$/g, "");
  return line.length > 180 ? `${line.slice(0, 177).trimEnd()}…` : line;
}

export async function describeAttachedImages(params: {
  userId: string;
  provider: AiProvider;
  apiKey?: string;
  urls: string[];
}): Promise<ImageDescriptions> {
  const byUrl = new Map<string, string>();
  const usage = { inputTokens: 0, outputTokens: 0 };
  const generate = TOOL_CAPABLE_PROVIDERS[params.provider];
  const model = resolveModel(params.provider, "BASIC");

  await Promise.all(
    params.urls.map(async (url) => {
      try {
        const key = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
        if (!key.startsWith(`private/sol-attachments/${params.userId}/`)) return;
        const file = await readObject(url);
        const type = (file.contentType || "").split(";")[0].trim().toLowerCase();
        if (!MODEL_IMAGE_TYPES.has(type) || file.body.length > MAX_IMAGE_BYTES) return;
        const result = await generate({
          model,
          apiKey: params.apiKey,
          systemPrompt: "You write short, accurate captions for images people share in a chat.",
          conversationHistory: [
            {
              role: "user",
              content: [
                { type: "image", source: { type: "base64", media_type: type, data: file.body.toString("base64") } },
                { type: "text", text: PROMPT },
              ],
            },
          ],
          maxTokens: 80,
        });
        usage.inputTokens += result.usage.inputTokens;
        usage.outputTokens += result.usage.outputTokens;
        const text = (Array.isArray(result.content) ? result.content : [])
          .filter((b: { type?: string }) => b?.type === "text")
          .map((b: { text?: string }) => b.text ?? "")
          .join(" ");
        if (text.trim()) byUrl.set(url, tidy(text));
      } catch (err) {
        // A missing caption is fine — the image still shows with its name.
        console.warn("[sol] couldn't describe an attached image:", err instanceof Error ? err.message : err);
      }
    }),
  );
  return { byUrl, usage };
}
