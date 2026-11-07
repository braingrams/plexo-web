// Batches build output into small messages for the live log. Output arrives in many small chunks,
// so a message is sent at most every `flushMs` or once `maxBytes` of text is waiting, whichever comes
// first. The caller passes `send`, which posts one batch (the handler sends it to the events queue).

export type LogBatch = { seq: number; lines: string[] };

export function createLogStreamer(
  send: (batch: LogBatch) => Promise<void>,
  options: { flushMs?: number; maxBytes?: number } = {},
) {
  const flushMs = options.flushMs ?? 700;
  const maxBytes = options.maxBytes ?? 8000;
  let partial = "";
  let pending: string[] = [];
  let pendingBytes = 0;
  let seq = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let chain: Promise<void> = Promise.resolve();

  const enqueueSend = (lines: string[]) => {
    const batch = { seq: seq++, lines };
    // Sends run one after another, so a slow send can't reorder batches.
    chain = chain.then(() => send(batch)).catch((err) => console.error("sending build log failed", err));
    return chain;
  };

  const flush = (): Promise<void> => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!pending.length) return chain;
    const lines = pending;
    pending = [];
    pendingBytes = 0;
    return enqueueSend(lines);
  };

  return {
    /** Adds output text. Complete lines are queued; a trailing partial line waits for its newline. */
    push(text: string): void {
      const combined = partial + text;
      const parts = combined.split("\n");
      partial = parts.pop() ?? "";
      for (const line of parts) {
        pending.push(line);
        pendingBytes += line.length + 1;
      }
      if (pendingBytes >= maxBytes) {
        void flush();
      } else if (pending.length && !timer) {
        timer = setTimeout(() => void flush(), flushMs);
      }
    },
    /** Sends everything still waiting, including a final line with no newline. Resolves when sent. */
    async close(): Promise<void> {
      if (partial) {
        pending.push(partial);
        partial = "";
      }
      await flush();
      await chain;
    },
  };
}
