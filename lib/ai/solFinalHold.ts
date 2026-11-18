// Holds back the model's streamed text while a quality decision is pending, so the owner never sees a "done"
// message that is then superseded by fix rounds, and nothing superseded is ever saved.
//
// One instance per model round. While `shouldHold()` is true (a page was built or edited this turn) text deltas are
// buffered instead of streamed. At the end of the round the loop either `release()`s them unchanged (the answer
// passed the check), `discard()`s them (the check refused it and a fix round follows), or `take()`s them to keep
// for later (the visual review may still ask for one more fix). Narration that comes right before a tool call is
// released the moment the tool call starts, so progress text stays live; only a final answer is ever held.
// Without a build or edit this turn, text streams exactly as before (no delay at all).

export type FinalHold = {
  /** Wrap for the model call's onTextDelta. */
  onTextDelta: (delta: string) => void;
  /** Call when the model starts writing a tool call: text before it is narration, not a final answer. */
  onToolStart: () => void;
  /** Stream everything held, unchanged. */
  release: () => void;
  /** Throw away what was held (never streamed, never saved). */
  discard: () => void;
  /** Hand back what was held (and clear it) without streaming it. */
  take: () => string;
  /** What is held right now. */
  held: () => string;
};

export function createFinalHold(emit: (delta: string) => void, shouldHold: () => boolean, onHoldStart?: () => void): FinalHold {
  const holding = shouldHold();
  let buf: string[] = [];
  let passthrough = !holding;
  const flush = () => {
    const text = buf.join("");
    buf = [];
    if (text) emit(text);
  };
  return {
    onTextDelta(delta) {
      if (passthrough) return emit(delta);
      if (!buf.length) onHoldStart?.();
      buf.push(delta);
    },
    onToolStart() {
      if (passthrough) return;
      flush();
      passthrough = true;
    },
    release() {
      flush();
      passthrough = true;
    },
    discard() {
      buf = [];
    },
    take() {
      const text = buf.join("");
      buf = [];
      return text;
    },
    held: () => buf.join(""),
  };
}
