"use client";

import { AI_UNREACHABLE, aiErrorMessage } from "@/lib/ai/requestErrors";
import type { GenerationFrame } from "@/lib/ai/streamGeneration";

// The dashboard's way to run the AI builder: confirm the account can afford it first, then
// generate with progress streamed back as the page is written (/api/v1/ai/stream/generate).
// Where streaming isn't routed (local `next dev` has no CloudFront), it falls back to the
// buffered /api/v1/ai/generate — same answer, just no progress.

export interface AiRequestBody {
  mode: string;
  prompt: string;
  templateKind: "EMAIL" | "LANDING_PAGE";
  context: unknown;
  tier?: string;
  isBlogLayout?: boolean;
}

export interface CreditCheck {
  paidBy: "plexo" | "own-key" | "host";
  enough: boolean;
  estimatedCredits: number | null;
  balance: number | null;
  message?: string;
}

const HEADERS = { "Content-Type": "application/json", "x-api-key": "workspace-internal" };

/** Whether this request is affordable — null when it couldn't be checked (the generation re-checks anyway). */
export async function checkAiCredits(body: AiRequestBody): Promise<CreditCheck | null> {
  try {
    const res = await fetch("/api/v1/ai/estimate", { method: "POST", headers: HEADERS, body: JSON.stringify(body) });
    if (!res.ok) return null;
    return (await res.json()) as CreditCheck;
  } catch {
    return null;
  }
}

export async function generateWithProgress(
  body: AiRequestBody,
  onProgress?: (progress: { characters: number; attempt: number }) => void,
): Promise<{ summary: string; result: unknown }> {
  let res: Response;
  try {
    res = await fetch("/api/v1/ai/stream/generate", { method: "POST", headers: HEADERS, body: JSON.stringify(body) });
  } catch {
    throw new Error(AI_UNREACHABLE);
  }
  const contentType = res.headers.get("content-type") ?? "";
  if (res.status === 404 && !contentType.includes("json")) return generateBuffered(body);
  if (!res.ok || !contentType.includes("ndjson") || !res.body) {
    const errorBody = await res.json().catch(() => null);
    throw new Error(aiErrorMessage(res.status, errorBody, "The AI couldn't finish this. Try again."));
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch {
      throw new Error("The connection dropped before your page was finished. Try again.");
    }
    if (chunk.done) break;
    buffered += decoder.decode(chunk.value, { stream: true });
    let newline: number;
    while ((newline = buffered.indexOf("\n")) >= 0) {
      const line = buffered.slice(0, newline).trim();
      buffered = buffered.slice(newline + 1);
      if (!line) continue;
      let frame: GenerationFrame;
      try {
        frame = JSON.parse(line) as GenerationFrame;
      } catch {
        continue;
      }
      if (frame.type === "progress") onProgress?.({ characters: frame.characters, attempt: frame.attempt });
      else if (frame.type === "done") return { summary: frame.summary, result: frame.result };
      else if (frame.type === "error") throw new Error(frame.error);
    }
  }
  throw new Error("The connection dropped before your page was finished. Try again.");
}

async function generateBuffered(body: AiRequestBody): Promise<{ summary: string; result: unknown }> {
  let res: Response;
  try {
    res = await fetch("/api/v1/ai/generate", { method: "POST", headers: HEADERS, body: JSON.stringify(body) });
  } catch {
    throw new Error(AI_UNREACHABLE);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(aiErrorMessage(res.status, data, "The AI couldn't finish this. Try again."));
  return data as { summary: string; result: unknown };
}
