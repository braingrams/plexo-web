import { parseGenerateBody, planGeneration, resolveAiKeyByRawKey, resolveAiKeyForUser, runGeneration } from "@/lib/ai/generateRequest";

// The streaming twin of /api/v1/ai/generate: the same request (lib/ai/generateRequest.ts),
// but the browser gets progress while the page is written and the result when it's done,
// over one long-lived response (lambda/sol-chat serves it at /api/v1/ai/stream/generate —
// a response-streaming Lambda with a 5-minute limit, not the main server's buffered 60s).

export type GenerationFrame =
  | { type: "started" }
  | { type: "progress"; characters: number; attempt: number }
  | { type: "done"; summary: string; result: unknown }
  | { type: "error"; error: string };

export type GenerationCaller = { userId: string } | { rawKey: string };

const PROGRESS_EVERY_MS = 400;
/** Keeps the connection alive while the model thinks before writing (CloudFront drops idle origins). */
const HEARTBEAT_MS = 10_000;

/**
 * Everything that can be refused is decided before the stream opens, so a refusal is a real
 * HTTP status with a JSON error (not enough credits → 402, AI off → 403, bad request → 400).
 */
export async function prepareStreamedGeneration(
  caller: GenerationCaller,
  body: unknown,
): Promise<{ refused: { status: number; error: string } } | { run: (emit: (frame: GenerationFrame) => void) => Promise<void> }> {
  const resolved = "userId" in caller ? await resolveAiKeyForUser(caller.userId) : await resolveAiKeyByRawKey(caller.rawKey);
  if ("error" in resolved) return { refused: resolved };
  const parsed = parseGenerateBody(resolved.key, body);
  if ("error" in parsed) return { refused: parsed };
  const planned = await planGeneration(resolved.key, parsed.input);
  if ("error" in planned) return { refused: planned };

  return {
    run: async (emit) => {
      emit({ type: "started" });
      let latest = { characters: 0, attempt: 1 };
      let lastSent = 0;
      const heartbeat = setInterval(() => emit({ type: "progress", ...latest }), HEARTBEAT_MS);
      try {
        const answer = await runGeneration(resolved.key, parsed.input, planned.plan, (progress) => {
          latest = progress;
          const now = Date.now();
          if (now - lastSent >= PROGRESS_EVERY_MS) {
            lastSent = now;
            emit({ type: "progress", ...progress });
          }
        });
        emit({ type: "done", summary: answer.summary, result: answer.result });
      } catch (err) {
        // Already in plain words (lib/ai/generate.ts, lib/ai/providerErrors.ts).
        emit({ type: "error", error: err instanceof Error ? err.message : "Something went wrong generating this. Try again." });
      } finally {
        clearInterval(heartbeat);
      }
    },
  };
}
