import type { AskUserAnswer, ContentBlock, CreditInfo, SolMessage, ToolUseBlock } from "../../../sol/_components/types";

/** Where a SOL Studio run is: SOL is working, it is waiting for an answer, it finished, or it hit a problem. */
export type StudioState = "working" | "asking" | "done" | "error";

/**
 * What the SOL Studio screen needs from whatever is driving it. Two engines provide it: a real SOL
 * chat (useStudioChat: the same conversation as Ask SOL, started from a prompt) and a step-by-step
 * script (useStudioScript: real requests narrated as SOL's steps, e.g. personalizing a design).
 */
export type StudioEngine = {
  state: StudioState;
  /** What was said and done in earlier turns. */
  messages: SolMessage[];
  /** What SOL is doing right now (null when nothing is in flight). */
  pendingBlocks: ContentBlock[] | null;
  /** SOL's question while it waits for an answer. */
  question: ToolUseBlock | null;
  error: string | null;
  /** Set when the run stopped for lack of AI credits. */
  creditInfo: CreditInfo | null;
  dismissCredit: () => void;
  answer: (answers: AskUserAnswer[]) => void;
  /** An action SOL wants a yes/no for (chat only). */
  confirm?: (decision: "confirmed" | "declined") => void;
  confirmBusy?: boolean;
  /** Tries again after a problem. */
  retry: () => void;
  /** Stops SOL where it is. */
  stop: () => void;
  /** The Ask SOL conversation this is (chat only), so it can be continued there. */
  conversationId: string | null;
  /** Sends a follow-up message in the same conversation (chat only). */
  followUp?: (text: string) => void;
};

/** What a script gets to work with: show a real step, say something, ask the owner something. */
export type StudioApi = {
  /** Runs one real piece of work and shows it as a step: spinner while it runs, a check when done. `tool` picks the plain-words label. */
  step: <T>(tool: string, run: () => Promise<T>) => Promise<T>;
  say: (text: string) => void;
  /** Shows SOL's question(s) and waits for the answers. */
  ask: (questions: import("../../../sol/_components/types").AskUserQuestionSpec[]) => Promise<AskUserAnswer[]>;
};

/** A script step failed because the account is out of AI credits. */
export class StudioCreditsError extends Error {
  constructor(public readonly info: CreditInfo) {
    super("Out of AI credits");
    this.name = "StudioCreditsError";
  }
}
