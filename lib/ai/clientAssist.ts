"use client";

import { AI_UNREACHABLE, aiErrorMessage } from "@/lib/ai/requestErrors";
import type { AssistFrame } from "@/lib/ai/pageAssist";

// The editor's SOL panel talking to SOL: the question goes to /api/v1/ai/stream/assist (lib/ai/pageAssist.ts) and the answer
// comes back as it is written. `onText` gets the WHOLE reply so far each time more arrives; the promise ends with the full reply.
// Anything that goes wrong is returned as a plain-English reply (not thrown), so the panel shows the actual reason — "you're
// out of credits" — instead of a generic failure.

export interface AssistRequest {
  question: string;
  context: { nodeId?: string; nodeType?: string; nodeName?: string; pageId?: string; design?: unknown; catalog?: unknown };
  history?: Array<{ role: "you" | "sol"; text: string }>;
}

export async function askSolStreaming(request: AssistRequest, onText: (replySoFar: string) => void, signal?: AbortSignal): Promise<string> {
  let res: Response;
  try {
    res = await fetch("/api/v1/ai/stream/assist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: request.question, context: request.context, history: request.history ?? [] }),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    return AI_UNREACHABLE;
  }
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => null);
    return aiErrorMessage(res.status, body, "SOL couldn't answer that. Try again in a moment.");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  let reply = "";
  let finished = false;
  let failure: string | null = null;
  const take = (line: string) => {
    if (!line.trim()) return;
    let frame: AssistFrame;
    try {
      frame = JSON.parse(line) as AssistFrame;
    } catch {
      return;
    }
    if (frame.type === "token" && frame.text) {
      reply += frame.text;
      onText(reply);
    } else if (frame.type === "done") finished = true;
    else if (frame.type === "error") failure = frame.error;
  };

  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffered += decoder.decode(chunk.value, { stream: true });
      let newline: number;
      while ((newline = buffered.indexOf("\n")) >= 0) {
        take(buffered.slice(0, newline));
        buffered = buffered.slice(newline + 1);
      }
    }
    take(buffered);
  } catch (err) {
    if (signal?.aborted) throw err;
    failure = failure ?? "The connection dropped while SOL was answering. Try again.";
  }
  if (failure) return reply.trim() ? `${reply}\n\n${failure}` : failure;
  if (!finished && !reply.trim()) return "The connection dropped before SOL answered. Try again.";
  return reply;
}
