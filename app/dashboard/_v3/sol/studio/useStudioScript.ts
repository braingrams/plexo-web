"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ASK_USER_QUESTION_TOOL_NAME, type AskUserAnswer, type AskUserQuestionSpec, type ContentBlock, type CreditInfo, type ToolUseBlock } from "../../../sol/_components/types";
import { StudioCreditsError, type StudioApi, type StudioEngine } from "./types";

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2));
const isTool = (b: ContentBlock): b is ToolUseBlock => (b as { type?: string }).type === "tool_use";

/**
 * Runs a script of real work as a SOL conversation: each `step` shows up like one of SOL's own
 * steps, `ask` shows SOL's question and waits for the answer, `say` adds a line of text. Starts
 * on its own. If a step fails the owner can try again: answers already given are kept, so they
 * are never asked the same thing twice.
 */
export function useStudioScript<R>(script: (api: StudioApi) => Promise<R>, opts: { onFinished?: (result: R) => void } = {}): StudioEngine & { result: R | null } {
  const [blocks, setBlocks] = useState<ContentBlock[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creditInfo, setCreditInfo] = useState<CreditInfo | null>(null);
  const [finished, setFinished] = useState(false);
  const [result, setResult] = useState<R | null>(null);
  const scriptRef = useRef(script);
  scriptRef.current = script;
  const onFinishedRef = useRef(opts.onFinished);
  onFinishedRef.current = opts.onFinished;
  const runRef = useRef(0);
  const startedRef = useRef(false);
  const waiting = useRef<((answers: AskUserAnswer[]) => void) | null>(null);
  const given = useRef(new Map<string, AskUserAnswer[]>());

  const run = useCallback(async () => {
    const runId = ++runRef.current;
    const live = () => runRef.current === runId;
    const patch = (id: string, change: Partial<ToolUseBlock>) =>
      live() && setBlocks((prev) => prev.map((b) => (isTool(b) && b.id === id ? { ...b, ...change } : b)));
    setBlocks([]);
    setError(null);
    setCreditInfo(null);
    setFinished(false);
    waiting.current = null;

    const api: StudioApi = {
      say: (text) => {
        if (live()) setBlocks((prev) => [...prev, { type: "text", text }]);
      },
      step: async (tool, doWork) => {
        const id = newId();
        if (live()) setBlocks((prev) => [...prev, { type: "tool_use", id, name: tool, input: {}, status: "running" } as ToolUseBlock]);
        try {
          const value = await doWork();
          patch(id, { status: "success" });
          return value;
        } catch (e) {
          patch(id, { status: "error" });
          throw e;
        }
      },
      ask: (questions: AskUserQuestionSpec[]) => {
        const key = JSON.stringify(questions.map((q) => q.question));
        const id = newId();
        const known = given.current.get(key);
        if (known) {
          if (live()) setBlocks((prev) => [...prev, { type: "tool_use", id, name: ASK_USER_QUESTION_TOOL_NAME, input: { questions }, status: "success", result: known } as ToolUseBlock]);
          return Promise.resolve(known);
        }
        if (live()) setBlocks((prev) => [...prev, { type: "tool_use", id, name: ASK_USER_QUESTION_TOOL_NAME, input: { questions }, status: "awaiting_confirmation" } as ToolUseBlock]);
        return new Promise<AskUserAnswer[]>((resolve) => {
          waiting.current = (answers) => {
            waiting.current = null;
            given.current.set(key, answers);
            patch(id, { status: "success", result: answers });
            resolve(answers);
          };
        });
      },
    };

    try {
      const value = await scriptRef.current(api);
      if (!live()) return;
      setResult(value);
      setFinished(true);
      onFinishedRef.current?.(value);
    } catch (e) {
      if (!live()) return;
      if (e instanceof StudioCreditsError) {
        setCreditInfo(e.info);
        setError("SOL needs more AI credits to carry on. Add some and try again: nothing was changed.");
      } else setError(e instanceof Error && e.message ? e.message : "SOL hit a snag. Please try again: nothing was changed.");
    }
  }, []);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void run();
  }, [run]);

  const question = blocks.find((b): b is ToolUseBlock => isTool(b) && b.name === ASK_USER_QUESTION_TOOL_NAME && b.status === "awaiting_confirmation") ?? null;
  return {
    state: error ? "error" : question ? "asking" : finished ? "done" : "working",
    messages: [],
    pendingBlocks: blocks,
    question,
    error,
    creditInfo,
    dismissCredit: () => setCreditInfo(null),
    answer: (answers) => waiting.current?.(answers),
    retry: () => void run(),
    stop: () => {
      runRef.current++;
    },
    conversationId: null,
    result,
  };
}
